import { create } from "zustand";
import {
  createEmptyDocument,
  makeId,
  type Document,
  type Shape,
} from "../model/types";
import { initialViewport, type Viewport } from "../model/viewport";

export type ToolId = "select" | "rect" | "ellipse" | "line" | "pen";

/** Default visual style applied to newly created shapes. */
export interface StyleDefaults {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

interface HistoryState {
  past: Document[];
  future: Document[];
}

export interface EditorState {
  doc: Document;
  selection: string[];
  tool: ToolId;
  viewport: Viewport;
  style: StyleDefaults;
  history: HistoryState;

  // --- internal interaction bookkeeping (not for UI) ---
  _pending: Document | null;
  _dirty: boolean;

  // tool / viewport / selection -------------------------------------------
  setTool: (tool: ToolId) => void;
  setViewport: (vp: Viewport) => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;

  // style ------------------------------------------------------------------
  setStyle: (patch: Partial<StyleDefaults>) => void;

  // document lifecycle -----------------------------------------------------
  newDocument: () => void;
  loadDocument: (doc: Document) => void;

  // history-wrapped mutations ---------------------------------------------
  addShape: (shape: Shape, select?: boolean) => void;
  deleteSelected: () => void;
  updateSelectedStyle: (patch: Partial<StyleStylableFields>) => void;
  bringToFront: () => void;
  sendToBack: () => void;

  // interaction transactions (for drags) ----------------------------------
  beginInteraction: () => void;
  applyShapes: (next: Record<string, Shape>) => void;
  setDoc: (doc: Document) => void;
  endInteraction: () => void;

  undo: () => void;
  redo: () => void;
}

/** Style fields that live directly on a shape and can be edited in the panel. */
export interface StyleStylableFields {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
}

const HISTORY_LIMIT = 100;

function clone(doc: Document): Document {
  return {
    order: [...doc.order],
    shapes: Object.fromEntries(
      Object.entries(doc.shapes).map(([k, v]) => [k, { ...v }])
    ),
  };
}

export const useEditor = create<EditorState>((set, get) => {
  /** Push the current doc onto the undo stack, then apply `next`. */
  function transact(next: Document) {
    const { doc, history } = get();
    const past = [...history.past, clone(doc)];
    if (past.length > HISTORY_LIMIT) past.shift();
    set({ doc: next, history: { past, future: [] } });
  }

  return {
    doc: createEmptyDocument(),
    selection: [],
    tool: "select",
    viewport: initialViewport,
    style: { fill: "#4f8cff", stroke: "#1b1b1b", strokeWidth: 2 },
    history: { past: [], future: [] },
    _pending: null,
    _dirty: false,

    setTool: (tool) => set({ tool, selection: tool === "select" ? get().selection : [] }),
    setViewport: (viewport) => set({ viewport }),
    setSelection: (ids) => set({ selection: ids }),
    toggleSelection: (id) => {
      const cur = get().selection;
      set({
        selection: cur.includes(id)
          ? cur.filter((s) => s !== id)
          : [...cur, id],
      });
    },
    clearSelection: () => set({ selection: [] }),

    setStyle: (patch) => set({ style: { ...get().style, ...patch } }),

    newDocument: () =>
      set({
        doc: createEmptyDocument(),
        selection: [],
        history: { past: [], future: [] },
        _pending: null,
        _dirty: false,
      }),

    loadDocument: (doc) =>
      set({
        doc,
        selection: [],
        history: { past: [], future: [] },
        _pending: null,
        _dirty: false,
      }),

    addShape: (shape, select = true) => {
      const { doc } = get();
      const next: Document = {
        shapes: { ...doc.shapes, [shape.id]: shape },
        order: [...doc.order, shape.id],
      };
      transact(next);
      if (select) set({ selection: [shape.id] });
    },

    deleteSelected: () => {
      const { doc, selection } = get();
      if (selection.length === 0) return;
      const shapes = { ...doc.shapes };
      for (const id of selection) delete shapes[id];
      const next: Document = {
        shapes,
        order: doc.order.filter((id) => !selection.includes(id)),
      };
      transact(next);
      set({ selection: [] });
    },

    updateSelectedStyle: (patch) => {
      const { doc, selection } = get();
      if (selection.length === 0) return;
      const shapes = { ...doc.shapes };
      for (const id of selection) {
        if (shapes[id]) shapes[id] = { ...shapes[id], ...patch } as Shape;
      }
      transact({ ...doc, shapes });
    },

    bringToFront: () => {
      const { doc, selection } = get();
      if (selection.length === 0) return;
      const rest = doc.order.filter((id) => !selection.includes(id));
      const moved = doc.order.filter((id) => selection.includes(id));
      transact({ ...doc, order: [...rest, ...moved] });
    },

    sendToBack: () => {
      const { doc, selection } = get();
      if (selection.length === 0) return;
      const rest = doc.order.filter((id) => !selection.includes(id));
      const moved = doc.order.filter((id) => selection.includes(id));
      transact({ ...doc, order: [...moved, ...rest] });
    },

    beginInteraction: () => set({ _pending: clone(get().doc), _dirty: false }),

    applyShapes: (next) => {
      const { doc } = get();
      set({ doc: { ...doc, shapes: { ...doc.shapes, ...next } }, _dirty: true });
    },

    setDoc: (doc) => set({ doc, _dirty: true }),

    endInteraction: () => {
      const { _pending, _dirty, history } = get();
      if (_pending && _dirty) {
        const past = [...history.past, _pending];
        if (past.length > HISTORY_LIMIT) past.shift();
        set({ history: { past, future: [] } });
      }
      set({ _pending: null, _dirty: false });
    },

    undo: () => {
      const { history, doc } = get();
      if (history.past.length === 0) return;
      const past = [...history.past];
      const prev = past.pop()!;
      set({
        doc: prev,
        history: { past, future: [clone(doc), ...history.future] },
        selection: get().selection.filter((id) => prev.shapes[id]),
      });
    },

    redo: () => {
      const { history, doc } = get();
      if (history.future.length === 0) return;
      const [next, ...future] = history.future;
      set({
        doc: next,
        history: { past: [...history.past, clone(doc)], future },
        selection: get().selection.filter((id) => next.shapes[id]),
      });
    },
  };
});

/** Build a shape style record from the current style defaults. */
export function styleFromDefaults(style: StyleDefaults) {
  return {
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    opacity: 1,
  };
}

export { makeId };
