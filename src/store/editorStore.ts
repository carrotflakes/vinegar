import { create } from "zustand";
import {
  createEmptyDocument,
  makeId,
  type Document,
  type Shape,
} from "../model/types";
import { booleanShapes, type BoolOp } from "../model/boolean";
import { translateShape } from "../model/transforms";
import { initialViewport, type Viewport } from "../model/viewport";

export type ToolId =
  | "select"
  | "node"
  | "rect"
  | "ellipse"
  | "line"
  | "pen"
  | "pencil";

/** A specific anchor of a Bézier shape currently targeted for node editing. */
export interface EditNode {
  shapeId: string;
  index: number;
}

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
  /** Anchor highlighted for node editing (pen vertex tool). */
  editNode: EditNode | null;
  /** Whether move-drag snaps to other shapes' alignment lines. */
  snapEnabled: boolean;
  /** Whether move-drag snaps to a fixed world-unit grid. */
  gridSnap: boolean;
  gridSize: number;

  // --- internal interaction bookkeeping (not for UI) ---
  _pending: Document | null;
  _dirty: boolean;

  // tool / viewport / selection -------------------------------------------
  setTool: (tool: ToolId) => void;
  setViewport: (vp: Viewport) => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  setEditNode: (node: EditNode | null) => void;
  deleteEditNode: () => void;
  toggleSnap: () => void;
  toggleGridSnap: () => void;

  // style ------------------------------------------------------------------
  setStyle: (patch: Partial<StyleDefaults>) => void;

  // document lifecycle -----------------------------------------------------
  newDocument: () => void;
  loadDocument: (doc: Document) => void;

  // clipboard --------------------------------------------------------------
  clipboard: Shape[];
  copySelected: () => void;
  cutSelected: () => void;
  paste: () => void;
  duplicateSelected: () => void;

  // history-wrapped mutations ---------------------------------------------
  addShape: (shape: Shape, select?: boolean) => void;
  deleteSelected: () => void;
  updateSelectedStyle: (patch: Partial<StyleStylableFields>) => void;
  bringToFront: () => void;
  sendToBack: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  booleanSelected: (op: BoolOp) => void;
  toggleHidden: (id: string) => void;
  toggleLocked: (id: string) => void;
  renameShape: (id: string, name: string) => void;
  setOrder: (order: string[]) => void;

  // interaction transactions (for drags) ----------------------------------
  beginInteraction: () => void;
  applyShapes: (next: Record<string, Shape>) => void;
  setDoc: (doc: Document) => void;
  endInteraction: () => void;

  undo: () => void;
  redo: () => void;
}

/** Shape fields that can be edited from the properties panel. */
export interface StyleStylableFields {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  rotation: number;
}

const HISTORY_LIMIT = 100;
const PASTE_OFFSET = 12;

/**
 * Deep-clone shapes for paste/duplicate: assign fresh ids, remap group ids so
 * pasted groups stay grouped (and independent of the source), and offset them.
 */
function cloneForPaste(shapes: Shape[], offset: number): Shape[] {
  const groupMap = new Map<string, string>();
  return shapes.map((s) => {
    const copy = structuredClone(s);
    copy.id = makeId(copy.type);
    if (s.groupId) {
      let gid = groupMap.get(s.groupId);
      if (!gid) {
        gid = makeId("group");
        groupMap.set(s.groupId, gid);
      }
      copy.groupId = gid;
    }
    return translateShape(copy, offset, offset);
  });
}

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
    editNode: null,
    snapEnabled: true,
    gridSnap: false,
    gridSize: 50,
    clipboard: [],
    _pending: null,
    _dirty: false,

    setTool: (tool) =>
      set({
        tool,
        // Keep the selection for tools that operate on it; clear for drawing.
        selection:
          tool === "select" || tool === "node" ? get().selection : [],
        editNode: null,
      }),
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
    clearSelection: () => set({ selection: [], editNode: null }),
    setEditNode: (node) => set({ editNode: node }),
    toggleSnap: () => set({ snapEnabled: !get().snapEnabled }),
    toggleGridSnap: () => set({ gridSnap: !get().gridSnap }),

    deleteEditNode: () => {
      const { doc, editNode } = get();
      if (!editNode) return;
      const shape = doc.shapes[editNode.shapeId];
      if (!shape || shape.type !== "bezier") return;
      const anchors = shape.anchors.filter((_, i) => i !== editNode.index);
      if (anchors.length < 2) {
        // Too few anchors left to form a curve — remove the whole shape.
        const shapes = { ...doc.shapes };
        delete shapes[editNode.shapeId];
        transact({
          shapes,
          order: doc.order.filter((id) => id !== editNode.shapeId),
        });
        set({ selection: [], editNode: null });
        return;
      }
      transact({
        ...doc,
        shapes: { ...doc.shapes, [editNode.shapeId]: { ...shape, anchors } },
      });
      set({ editNode: null });
    },

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

    copySelected: () => {
      const { doc, selection } = get();
      const sel = new Set(selection);
      // Preserve document stacking order in the clipboard.
      const shapes = doc.order
        .filter((id) => sel.has(id))
        .map((id) => structuredClone(doc.shapes[id]));
      set({ clipboard: shapes });
    },

    cutSelected: () => {
      get().copySelected();
      get().deleteSelected();
    },

    paste: () => {
      const { clipboard, doc } = get();
      if (clipboard.length === 0) return;
      const pasted = cloneForPaste(clipboard, PASTE_OFFSET);
      const shapes = { ...doc.shapes };
      const order = [...doc.order];
      for (const s of pasted) {
        shapes[s.id] = s;
        order.push(s.id);
      }
      transact({ shapes, order });
      set({ selection: pasted.map((s) => s.id) });
    },

    duplicateSelected: () => {
      const { doc, selection } = get();
      if (selection.length === 0) return;
      const sel = new Set(selection);
      const src = doc.order
        .filter((id) => sel.has(id))
        .map((id) => doc.shapes[id]);
      const dup = cloneForPaste(src, PASTE_OFFSET);
      const shapes = { ...doc.shapes };
      const order = [...doc.order];
      for (const s of dup) {
        shapes[s.id] = s;
        order.push(s.id);
      }
      transact({ shapes, order });
      set({ selection: dup.map((s) => s.id) });
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

    groupSelected: () => {
      const { doc, selection } = get();
      if (selection.length < 2) return;
      const gid = makeId("group");
      const shapes = { ...doc.shapes };
      for (const id of selection) {
        if (shapes[id]) shapes[id] = { ...shapes[id], groupId: gid };
      }
      transact({ ...doc, shapes });
    },

    ungroupSelected: () => {
      const { doc, selection } = get();
      const shapes = { ...doc.shapes };
      let changed = false;
      for (const id of selection) {
        if (shapes[id]?.groupId) {
          shapes[id] = { ...shapes[id], groupId: null };
          changed = true;
        }
      }
      if (changed) transact({ ...doc, shapes });
    },

    booleanSelected: (op) => {
      const { doc, selection } = get();
      if (selection.length < 2) return;
      const sel = new Set(selection);
      const ordered = doc.order.filter((id) => sel.has(id));
      const result = booleanShapes(
        ordered.map((id) => doc.shapes[id]),
        op
      );
      if (!result) return;

      const minIdx = Math.min(...ordered.map((id) => doc.order.indexOf(id)));
      const keptBefore = doc.order.filter(
        (id, i) => !sel.has(id) && i < minIdx
      ).length;
      const order = doc.order.filter((id) => !sel.has(id));
      order.splice(keptBefore, 0, result.id);

      const shapes = { ...doc.shapes };
      for (const id of selection) delete shapes[id];
      shapes[result.id] = result;
      transact({ shapes, order });
      set({ selection: [result.id] });
    },

    toggleHidden: (id) => {
      const { doc } = get();
      const s = doc.shapes[id];
      if (!s) return;
      transact({
        ...doc,
        shapes: { ...doc.shapes, [id]: { ...s, hidden: !s.hidden } },
      });
      if (!s.hidden) {
        set({ selection: get().selection.filter((x) => x !== id) });
      }
    },

    toggleLocked: (id) => {
      const { doc } = get();
      const s = doc.shapes[id];
      if (!s) return;
      transact({
        ...doc,
        shapes: { ...doc.shapes, [id]: { ...s, locked: !s.locked } },
      });
      if (!s.locked) {
        set({ selection: get().selection.filter((x) => x !== id) });
      }
    },

    renameShape: (id, name) => {
      const { doc } = get();
      const s = doc.shapes[id];
      if (!s) return;
      transact({ ...doc, shapes: { ...doc.shapes, [id]: { ...s, name } } });
    },

    setOrder: (order) => {
      const { doc } = get();
      transact({ ...doc, order });
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

/** Build a shape's common fields from the current style defaults. */
export function styleFromDefaults(style: StyleDefaults) {
  return {
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    opacity: 1,
    rotation: 0,
    groupId: null,
  };
}

/**
 * Expand a set of shape ids to include every other member of any group they
 * belong to, so grouped shapes are always selected together.
 */
export function expandToGroups(doc: Document, ids: string[]): string[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const g = doc.shapes[id]?.groupId;
    if (g) groups.add(g);
  }
  if (groups.size === 0) return ids;
  const result = new Set(ids);
  for (const oid of doc.order) {
    const g = doc.shapes[oid]?.groupId;
    if (g && groups.has(g)) result.add(oid);
  }
  return [...result];
}

export { makeId };
