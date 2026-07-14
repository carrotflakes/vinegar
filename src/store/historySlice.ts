// Document lifecycle, undo history and drag-interaction batching. This slice
// also owns `transact`, the single entry point every other slice uses to
// commit a document change as an undoable step.

import { createEmptyDocument, type Document } from "../model/types";
import { hasValidClippingMasks } from "../model/clippingMask";
import { usePreferences } from "./preferencesStore";
import {
  clearTransient,
  type HistoryState,
  type HistoryActions,
  type StoreGet,
  type StoreSet,
} from "./state";

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

function clone(doc: Document): Document {
  return structuredClone(doc);
}

function documentReset(doc: Document) {
  return {
    doc,
    gridSize: doc.settings.gridSize,
    selection: [],
    editingSymbols: [],
    activeGroupId: null,
    selectedArtboardId: null,
    history: { past: [], future: [] },
    _pending: null,
    _dirty: false,
    ...clearTransient,
  };
}

export interface HistorySlice {
  /** Commit a document change as one undo step (optionally coalesced). */
  transact: (next: Document, coalesceKey?: string) => void;
  resetCoalesce: () => void;
  actions: HistoryActions;
}

export function createHistory(set: StoreSet, get: StoreGet): HistorySlice {
  // Repeated changes sharing a coalesce key within this window collapse into
  // one undo step (e.g. dragging a color slider).
  let coalesceKey: string | null = null;
  let coalesceTime = 0;
  const resetCoalesce = () => { coalesceKey = null; };
  const transact = (next: Document, key?: string) => {
    if (!hasValidClippingMasks(next)) return;
    const now = Date.now();
    if (key && key === coalesceKey && now - coalesceTime < 600) {
      coalesceTime = now; set({ doc: next }); return;
    }
    coalesceKey = key ?? null; coalesceTime = now;
    const { doc, history } = get();
    const past = [...history.past, clone(doc)].slice(-historyLimit());
    set({ doc: next, history: { past, future: [] } });
  };

  const actions: HistoryActions = {
    newDocument: () => { const doc = createEmptyDocument(); set({ ...documentReset(doc), savedDoc: doc }); },
    loadDocument: (doc) => set({ ...documentReset(doc), savedDoc: doc }),
    // savedDoc deliberately receives a clone. Dirty state is reference-based,
    // so recovered work continues to trigger beforeunload and autosave until
    // the user explicitly downloads it.
    recoverDocument: (doc) => set({ ...documentReset(doc), savedDoc: clone(doc) }),
    markSaved: () => set({ savedDoc: get().doc }),
    beginInteraction: () => set({ _pending: clone(get().doc), _dirty: false }),
    applyShapes: (next) => set({ doc: { ...get().doc, nodes: { ...get().doc.nodes, ...next } }, _dirty: true }),
    setDoc: (doc) => set({ doc, _dirty: true }),
    endInteraction: () => { resetCoalesce(); const { _pending, _dirty, history } = get(); if (_pending && _dirty) set({ history: { past: [...history.past, _pending].slice(-historyLimit()), future: [] } }); set({ _pending: null, _dirty: false }); },
    cancelInteraction: () => { resetCoalesce(); const { _pending, _dirty } = get(); if (_pending && _dirty) set({ doc: _pending, ...clearTransient }); set({ _pending: null, _dirty: false }); },
    undo: () => { resetCoalesce(); const { history, doc } = get(); if (!history.past.length) return; const past = [...history.past], prev = past.pop()!; set({ doc: prev, history: { past, future: [clone(doc), ...history.future].slice(0, historyLimit()) }, selection: get().selection.filter((id) => !!prev.nodes[id]), editingSymbols: get().editingSymbols.filter((id) => !!prev.symbols[id]), selectedArtboardId: prev.artboards.some((ab) => ab.id === get().selectedArtboardId) ? get().selectedArtboardId : null, ...clearTransient }); },
    redo: () => { resetCoalesce(); const { history, doc } = get(); if (!history.future.length) return; const [next, ...future] = history.future; set({ doc: next, history: { past: [...history.past, clone(doc)].slice(-historyLimit()), future }, selection: get().selection.filter((id) => !!next.nodes[id]), editingSymbols: get().editingSymbols.filter((id) => !!next.symbols[id]), selectedArtboardId: next.artboards.some((ab) => ab.id === get().selectedArtboardId) ? get().selectedArtboardId : null, ...clearTransient }); },
  };

  return { transact, resetCoalesce, actions };
}
