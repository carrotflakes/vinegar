import { create } from "zustand";
import {
  createEmptyDocument,
  makeId,
  type Bounds,
  type Document,
  type Shape,
} from "../model/types";
import { booleanShapes, type BoolOp } from "../model/boolean";
import { shapeBounds, unionWorldBounds, worldShapeBounds } from "../model/bounds";
import { resizeShapeToBounds, translateShape } from "../model/transforms";
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

export type AlignType =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vmiddle"
  | "bottom";

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
  /** Recently used colors (most recent first), persisted across sessions. */
  recentColors: string[];
  /** User-saved color swatches, persisted across sessions. */
  savedSwatches: string[];

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
  addRecentColor: (hex: string) => void;
  addSwatch: (hex: string) => void;
  removeSwatch: (hex: string) => void;

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
  setShapeGeometry: (
    id: string,
    patch: Partial<{ x: number; y: number; width: number; height: number }>
  ) => void;
  bringToFront: () => void;
  sendToBack: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  alignSelected: (type: AlignType) => void;
  distributeSelected: (axis: "h" | "v") => void;
  setClosedSelected: (closed: boolean) => void;
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
const RECENT_COLORS_KEY = "vinegar.recentColors";
const RECENT_COLORS_MAX = 12;
const SAVED_SWATCHES_KEY = "vinegar.savedSwatches";

function loadColorList(key: string, max = Infinity): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(raw)
      ? raw.filter((c) => typeof c === "string").slice(0, max)
      : [];
  } catch {
    return [];
  }
}

function saveColorList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // ignore storage errors (private mode, etc.)
  }
}

/** Align/distribute item: a single shape or a whole group, with its world AABB. */
interface AlignItem {
  ids: string[];
  bounds: Bounds;
}

/** Group the selection into alignment items (groups move as one unit). */
function selectionItems(doc: Document, selection: string[]): AlignItem[] {
  const groups = new Map<string, string[]>();
  const items: AlignItem[] = [];
  for (const id of selection) {
    const s = doc.shapes[id];
    if (!s) continue;
    if (s.groupId) {
      const arr = groups.get(s.groupId) ?? [];
      arr.push(id);
      groups.set(s.groupId, arr);
    } else {
      items.push({ ids: [id], bounds: worldShapeBounds(s) });
    }
  }
  for (const ids of groups.values()) {
    const b = unionWorldBounds(ids.map((i) => doc.shapes[i]));
    if (b) items.push({ ids, bounds: b });
  }
  return items;
}

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
  // History coalescing: consecutive transacts with the same key within a short
  // window fold into a single undo step (e.g. dragging a color/opacity slider).
  let coalesceKey: string | null = null;
  let coalesceTime = 0;
  const COALESCE_MS = 600;

  function resetCoalesce() {
    coalesceKey = null;
  }

  /**
   * Push the current doc onto the undo stack, then apply `next`. When `key` is
   * given and matches the previous transact within COALESCE_MS, the change is
   * merged into the current undo step instead of starting a new one.
   */
  function transact(next: Document, key?: string) {
    const now = Date.now();
    if (key && key === coalesceKey && now - coalesceTime < COALESCE_MS) {
      coalesceTime = now;
      set({ doc: next });
      return;
    }
    coalesceKey = key ?? null;
    coalesceTime = now;
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
    recentColors: loadColorList(RECENT_COLORS_KEY, RECENT_COLORS_MAX),
    savedSwatches: loadColorList(SAVED_SWATCHES_KEY),
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

    addRecentColor: (hex) => {
      const c = hex.toLowerCase();
      const next = [c, ...get().recentColors.filter((x) => x !== c)].slice(
        0,
        RECENT_COLORS_MAX
      );
      saveColorList(RECENT_COLORS_KEY, next);
      set({ recentColors: next });
    },

    addSwatch: (hex) => {
      const c = hex.toLowerCase();
      if (get().savedSwatches.includes(c)) return;
      const next = [...get().savedSwatches, c];
      saveColorList(SAVED_SWATCHES_KEY, next);
      set({ savedSwatches: next });
    },

    removeSwatch: (hex) => {
      const next = get().savedSwatches.filter((x) => x !== hex.toLowerCase());
      saveColorList(SAVED_SWATCHES_KEY, next);
      set({ savedSwatches: next });
    },

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
      // Coalesce rapid edits of the same field (slider/color drag) into one undo.
      transact({ ...doc, shapes }, "style:" + Object.keys(patch).sort().join(","));
    },

    setShapeGeometry: (id, patch) => {
      const { doc } = get();
      const s = doc.shapes[id];
      if (!s) return;
      const b = shapeBounds(s);
      const width = Math.max(1, patch.width ?? b.width);
      const height = Math.max(1, patch.height ?? b.height);
      const x = patch.x ?? b.x;
      const y = patch.y ?? b.y;
      // Resize the (unrotated) local box anchored at its top-left, then move it.
      let next = resizeShapeToBounds(s, b, {
        x: b.x,
        y: b.y,
        width,
        height,
      });
      next = translateShape(next, x - b.x, y - b.y);
      transact({ ...doc, shapes: { ...doc.shapes, [id]: next } }, "geom:" + id);
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

    alignSelected: (type) => {
      const { doc, selection } = get();
      const items = selectionItems(doc, selection);
      if (items.length < 2) return;
      const union = unionWorldBounds(
        selection.map((id) => doc.shapes[id]).filter(Boolean) as Shape[]
      );
      if (!union) return;
      const shapes = { ...doc.shapes };
      for (const item of items) {
        const b = item.bounds;
        let dx = 0;
        let dy = 0;
        switch (type) {
          case "left":
            dx = union.x - b.x;
            break;
          case "hcenter":
            dx = union.x + union.width / 2 - (b.x + b.width / 2);
            break;
          case "right":
            dx = union.x + union.width - (b.x + b.width);
            break;
          case "top":
            dy = union.y - b.y;
            break;
          case "vmiddle":
            dy = union.y + union.height / 2 - (b.y + b.height / 2);
            break;
          case "bottom":
            dy = union.y + union.height - (b.y + b.height);
            break;
        }
        if (dx || dy) {
          for (const id of item.ids)
            shapes[id] = translateShape(shapes[id], dx, dy);
        }
      }
      transact({ ...doc, shapes });
    },

    distributeSelected: (axis) => {
      const { doc, selection } = get();
      const items = selectionItems(doc, selection);
      if (items.length < 3) return;
      const horiz = axis === "h";
      const start = (b: Bounds) => (horiz ? b.x : b.y);
      const size = (b: Bounds) => (horiz ? b.width : b.height);
      const sorted = [...items].sort(
        (a, b) => start(a.bounds) - start(b.bounds)
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span =
        start(last.bounds) + size(last.bounds) - start(first.bounds);
      const totalSize = sorted.reduce((sum, it) => sum + size(it.bounds), 0);
      const gap = (span - totalSize) / (sorted.length - 1);

      const shapes = { ...doc.shapes };
      let cursor = start(first.bounds) + size(first.bounds) + gap;
      for (let i = 1; i < sorted.length - 1; i++) {
        const it = sorted[i];
        const delta = cursor - start(it.bounds);
        if (delta) {
          for (const id of it.ids)
            shapes[id] = translateShape(
              shapes[id],
              horiz ? delta : 0,
              horiz ? 0 : delta
            );
        }
        cursor += size(it.bounds) + gap;
      }
      transact({ ...doc, shapes });
    },

    setClosedSelected: (closed) => {
      const { doc, selection } = get();
      const shapes = { ...doc.shapes };
      let changed = false;
      for (const id of selection) {
        const s = shapes[id];
        if (
          s &&
          (s.type === "path" || s.type === "bezier") &&
          s.closed !== closed
        ) {
          shapes[id] = { ...s, closed };
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
      resetCoalesce();
      const { _pending, _dirty, history } = get();
      if (_pending && _dirty) {
        const past = [...history.past, _pending];
        if (past.length > HISTORY_LIMIT) past.shift();
        set({ history: { past, future: [] } });
      }
      set({ _pending: null, _dirty: false });
    },

    undo: () => {
      resetCoalesce();
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
      resetCoalesce();
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
