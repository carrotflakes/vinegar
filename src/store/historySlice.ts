// Document lifecycle, undo history and drag-interaction batching. This slice
// also owns `transact`, the single entry point every other slice uses to
// commit a document change as an undoable step.

import { createEmptyDocument, type Document } from "../model/types";
import { hasValidSceneContainers } from "../model/sceneValidation";
import { applyDocumentPatches, diffDocument, documentsEqual, type DocumentPatch } from "./documentPatches";
import { usePreferences } from "./preferencesStore";
import {
  clearTransient,
  type DocumentRevision,
  type EditorData,
  type HistoryActions,
  type HistoryEntry,
  type HistoryState,
  type StoreGet,
  type StoreSet,
} from "./state";

let revisionCounter = 0;
const nextRevision = () => ++revisionCounter;

function historyLimit(): number {
  return usePreferences.getState().history.limit;
}

export function trimHistoryToLimit(
  history: HistoryState,
  limit: number
): HistoryState {
  if (history.past.length <= limit && history.future.length <= limit) {
    return history;
  }
  return {
    past: history.past.slice(-limit),
    future: history.future.slice(0, limit),
  };
}

function appendPast(past: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...past, entry].slice(-historyLimit());
}

function prependFuture(future: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...future].slice(0, historyLimit());
}

function createEntry(before: Document, after: Document, beforeRevision: number, afterRevision?: number): HistoryEntry | null {
  const { patches, inversePatches } = diffDocument(before, after);
  if (!patches.length) return null;
  return { patches, inversePatches, beforeRevision, afterRevision: afterRevision ?? nextRevision() };
}

type MapPatch = Extract<DocumentPatch, { type: "map" }>;

function mapPatchKeys(patch: MapPatch): Set<string> {
  return new Set([...patch.remove, ...patch.set.map(([key]) => key)]);
}

function patchesOverlap(first: readonly DocumentPatch[], second: readonly DocumentPatch[]): boolean {
  for (const a of first) {
    for (const b of second) {
      if (a.field !== b.field) continue;
      if (a.type !== "map" || b.type !== "map") return true;
      const keys = mapPatchKeys(a);
      if (b.remove.some((key) => keys.has(key)) || b.set.some(([key]) => keys.has(key))) return true;
    }
  }
  return false;
}

function revisionForDocument(doc: Document, revision: DocumentRevision, state: EditorData): DocumentRevision {
  const saved = state._savedRevision;
  if (saved?.history === revision.history) {
    if (documentsEqual(state.savedDoc, doc)) return { ...revision, maintenance: saved.maintenance };
    if (revision.maintenance === saved.maintenance) return { ...revision, maintenance: nextRevision() };
  }
  return revision;
}

function documentReset(doc: Document, saved: boolean) {
  const revision = { history: nextRevision(), maintenance: 0 };
  return {
    doc,
    gridSize: doc.settings.gridSize,
    selection: [],
    editingSymbols: [],
    activeGroupId: null,
    history: { past: [], future: [] },
    _interaction: null,
    _revision: revision,
    _savedRevision: saved ? revision : null,
    // A document that already carries scripts is untrusted until the user
    // enables it; an empty registry (new/blank doc) needs no consent.
    scriptsTrusted: !doc.scripts || Object.keys(doc.scripts).length === 0,
    scriptMeta: {},
    ...clearTransient,
  };
}

function restoredEditorState(doc: Document, get: StoreGet) {
  const state = get();
  return { selection: state.selection.filter((id) => !!doc.nodes[id]), editingSymbols: state.editingSymbols.filter((id) => !!doc.symbols[id]), ...clearTransient, selectedArtboardId: doc.artboards.some((artboard) => artboard.id === state.selectedArtboardId) ? state.selectedArtboardId : null };
}

export interface HistorySlice {
  /** Commit a document change as one undo step (optionally coalesced). */
  transact: (next: Document, coalesceKey?: string) => void;
  /** Publish a deliberate non-undoable document replacement. */
  replaceDocumentWithoutHistory: (next: Document, additionalState?: Partial<Pick<EditorData, "gridSize">>) => void;
  resetCoalesce: () => void;
  actions: HistoryActions;
}

export function createHistory(set: StoreSet, get: StoreGet): HistorySlice {
  // Repeated changes sharing a coalesce key within this window collapse into
  // one undo step (e.g. dragging a color slider).
  let coalesceKey: string | null = null, coalesceTime = 0, coalesceBase: Document | null = null, coalesceBeforeRevision = 0, coalesceAfterRevision = 0;
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  const resetCoalesce = () => { if (coalesceTimer !== null) clearTimeout(coalesceTimer); coalesceKey = null; coalesceTime = 0; coalesceBase = null; coalesceBeforeRevision = 0; coalesceAfterRevision = 0; coalesceTimer = null; };
  const armCoalesce = (key: string, base: Document, beforeRevision: number, afterRevision: number, time: number) => {
    resetCoalesce(); coalesceKey = key; coalesceBase = base; coalesceBeforeRevision = beforeRevision; coalesceAfterRevision = afterRevision; coalesceTime = time;
    coalesceTimer = setTimeout(resetCoalesce, 600);
  };
  const refreshCoalesce = (time: number) => { coalesceTime = time; if (coalesceTimer !== null) clearTimeout(coalesceTimer); coalesceTimer = setTimeout(resetCoalesce, 600); };
  const rollbackInteraction = (): boolean => {
    const state = get(), interaction = state._interaction;
    if (!interaction) return false;
    if (interaction.dirty) set({
      doc: interaction.before,
      _revision: revisionForDocument(
        interaction.before,
        { ...state._revision, history: interaction.beforeRevision },
        state
      ),
      ...clearTransient,
      selectedArtboardId: state.selectedArtboardId,
      editNodes: interaction.beforeEditNodes,
      _interaction: null,
    });
    else set({ _interaction: null });
    return true;
  };
  const finishInteraction = (): boolean => {
    const state = get(), interaction = state._interaction;
    if (!interaction) return false;
    if (!interaction.dirty) { set({ _interaction: null }); return false; }
    const entry = createEntry(interaction.before, state.doc, interaction.beforeRevision, interaction.afterRevision ?? undefined);
    if (!entry) { set({ _interaction: null, _revision: revisionForDocument(state.doc, { ...state._revision, history: interaction.beforeRevision }, state) }); return false; }
    set({ history: { past: appendPast(state.history.past, entry), future: [] }, _interaction: null, _revision: { ...state._revision, history: entry.afterRevision } });
    return true;
  };
  const transact = (next: Document, key?: string) => {
    let state = get();
    if (next === state.doc || !hasValidSceneContainers(next)) return;
    if (state._interaction) { resetCoalesce(); finishInteraction(); state = get(); }
    const now = Date.now(), last = state.history.past[state.history.past.length - 1];
    if (key && key === coalesceKey && coalesceBase && last?.afterRevision === coalesceAfterRevision && now - coalesceTime < 600) {
      const entry = createEntry(coalesceBase, next, coalesceBeforeRevision, coalesceAfterRevision);
      if (!entry) { set({ doc: next, history: { past: state.history.past.slice(0, -1), future: [] }, _revision: revisionForDocument(next, { ...state._revision, history: coalesceBeforeRevision }, state) }); resetCoalesce(); return; }
      set({ doc: next, history: { past: [...state.history.past.slice(0, -1), entry], future: [] }, _revision: { ...state._revision, history: entry.afterRevision } });
      refreshCoalesce(now); return;
    }
    resetCoalesce();
    const entry = createEntry(state.doc, next, state._revision.history);
    if (!entry) return;
    set({ doc: next, history: { past: appendPast(state.history.past, entry), future: [] }, _revision: { ...state._revision, history: entry.afterRevision } });
    if (key) armCoalesce(key, state.doc, entry.beforeRevision, entry.afterRevision, now);
  };
  const replaceDocumentWithoutHistory = (next: Document, additionalState: Partial<Pick<EditorData, "gridSize">> = {}) => {
    resetCoalesce();
    const state = get();
    if (next === state.doc || !hasValidSceneContainers(next)) { if (additionalState.gridSize !== undefined) set(additionalState); return; }
    const maintenancePatches = diffDocument(state.doc, next).patches;
    let interaction = state._interaction;
    let revision: DocumentRevision;
    if (interaction) {
      const interactionPatches = interaction.dirty ? diffDocument(interaction.before, state.doc).patches : [];
      if (patchesOverlap(interactionPatches, maintenancePatches)) revision = state._revision;
      else {
        const before = applyDocumentPatches(interaction.before, maintenancePatches);
        const baselineRevision = revisionForDocument(before, { history: interaction.beforeRevision, maintenance: nextRevision() }, state);
        interaction = { ...interaction, before };
        revision = { ...state._revision, maintenance: baselineRevision.maintenance };
      }
    } else revision = revisionForDocument(next, { ...state._revision, maintenance: nextRevision() }, state);
    set({ ...additionalState, doc: next, _interaction: interaction, _revision: revision });
  };

  const actions: HistoryActions = {
    newDocument: () => { resetCoalesce(); const doc = createEmptyDocument(); set({ ...documentReset(doc, true), savedDoc: doc }); },
    loadDocument: (doc) => { resetCoalesce(); set({ ...documentReset(doc, true), savedDoc: doc }); },
    recoverDocument: (doc) => { resetCoalesce(); set({ ...documentReset(doc, false), savedDoc: doc }); },
    markSaved: () => { resetCoalesce(); finishInteraction(); const state = get(); set({ savedDoc: state.doc, _savedRevision: state._revision }); },
    beginInteraction: () => {
      const state = get();
      if (!state._interaction) {
        set({
          _interaction: {
            before: state.doc,
            beforeEditNodes: [...state.editNodes],
            beforeRevision: state._revision.history,
            afterRevision: null,
            dirty: false,
          },
        });
      }
    },
    applyShapes: (next) => { const state = get(), interaction = state._interaction; if (!interaction || !Object.entries(next).some(([id, node]) => state.doc.nodes[id] !== node)) return; const afterRevision = interaction.afterRevision ?? nextRevision(); set({ doc: { ...state.doc, nodes: { ...state.doc.nodes, ...next } }, _interaction: { ...interaction, afterRevision, dirty: true }, _revision: { ...state._revision, history: afterRevision } }); },
    setDoc: (doc) => { const state = get(), interaction = state._interaction; if (!interaction || doc === state.doc) return; const afterRevision = interaction.afterRevision ?? nextRevision(); set({ doc, _interaction: { ...interaction, afterRevision, dirty: true }, _revision: { ...state._revision, history: afterRevision } }); },
    endInteraction: () => { resetCoalesce(); finishInteraction(); },
    cancelInteraction: () => { resetCoalesce(); rollbackInteraction(); },
    undo: () => { resetCoalesce(); if (rollbackInteraction()) return; const state = get(), entry = state.history.past[state.history.past.length - 1]; if (!entry) return; const doc = applyDocumentPatches(state.doc, entry.inversePatches); set({ doc, history: { past: state.history.past.slice(0, -1), future: prependFuture(state.history.future, entry) }, _revision: revisionForDocument(doc, { ...state._revision, history: entry.beforeRevision }, state), ...restoredEditorState(doc, get) }); },
    redo: () => { resetCoalesce(); if (rollbackInteraction()) return; const state = get(), entry = state.history.future[0]; if (!entry) return; const doc = applyDocumentPatches(state.doc, entry.patches); set({ doc, history: { past: appendPast(state.history.past, entry), future: state.history.future.slice(1) }, _revision: revisionForDocument(doc, { ...state._revision, history: entry.afterRevision }, state), ...restoredEditorState(doc, get) }); },
  };

  return { transact, replaceDocumentWithoutHistory, resetCoalesce, actions };
}
