// Document lifecycle, undo history and drag-interaction batching. This slice
// also owns `transact`, the single entry point every other slice uses to
// commit a document change as an undoable step.

import { createEmptyDocument, type Document } from "../model/types";
import {
  clearTransient,
  type HistoryActions,
  type StoreGet,
  type StoreSet,
} from "./state";

const HISTORY_LIMIT = 100;

function clone(doc: Document): Document {
  return structuredClone(doc);
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
    const now = Date.now();
    if (key && key === coalesceKey && now - coalesceTime < 600) {
      coalesceTime = now; set({ doc: next }); return;
    }
    coalesceKey = key ?? null; coalesceTime = now;
    const { doc, history } = get();
    const past = [...history.past, clone(doc)].slice(-HISTORY_LIMIT);
    set({ doc: next, history: { past, future: [] } });
  };

  const actions: HistoryActions = {
    newDocument: () => { const doc = createEmptyDocument(); set({ doc, gridSize: doc.settings.gridSize, selection: [], editingSymbols: [], history: { past: [], future: [] }, _pending: null, _dirty: false, ...clearTransient }); },
    loadDocument: (doc) => set({ doc, gridSize: doc.settings.gridSize, selection: [], editingSymbols: [], history: { past: [], future: [] }, _pending: null, _dirty: false, ...clearTransient }),
    beginInteraction: () => set({ _pending: clone(get().doc), _dirty: false }),
    applyShapes: (next) => set({ doc: { ...get().doc, nodes: { ...get().doc.nodes, ...next } }, _dirty: true }),
    setDoc: (doc) => set({ doc, _dirty: true }),
    endInteraction: () => { resetCoalesce(); const { _pending, _dirty, history } = get(); if (_pending && _dirty) set({ history: { past: [...history.past, _pending].slice(-HISTORY_LIMIT), future: [] } }); set({ _pending: null, _dirty: false }); },
    undo: () => { resetCoalesce(); const { history, doc } = get(); if (!history.past.length) return; const past = [...history.past], prev = past.pop()!; set({ doc: prev, history: { past, future: [clone(doc), ...history.future] }, selection: get().selection.filter((id) => !!prev.nodes[id]), editingSymbols: get().editingSymbols.filter((id) => !!prev.symbols[id]), ...clearTransient }); },
    redo: () => { resetCoalesce(); const { history, doc } = get(); if (!history.future.length) return; const [next, ...future] = history.future; set({ doc: next, history: { past: [...history.past, clone(doc)], future }, selection: get().selection.filter((id) => !!next.nodes[id]), editingSymbols: get().editingSymbols.filter((id) => !!next.symbols[id]), ...clearTransient }); },
  };

  return { transact, resetCoalesce, actions };
}
