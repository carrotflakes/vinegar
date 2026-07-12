import { create } from "zustand";
import {
  createEmptyDocument,
  makeId,
  type BlendMode,
  type Bounds,
  type Document,
  type Group,
  type Matrix,
  type SceneNode,
  type Shape,
  type Vec2,
} from "../model/types";
import { toggleAnchorSmooth } from "../model/bezier";
import { booleanShapes, isAreal, type BoolOp } from "../model/boolean";
import { nodeWorldBounds, shapeBounds, unionNodeWorldBounds } from "../model/bounds";
import { strokeOutline } from "../model/outlineStroke";
import {
  canMakeCompoundPathSelection,
  canReleaseCompoundPathSelection,
  makeCompoundPath,
  releaseCompoundPath,
} from "../model/compoundPath";
import { resizeShapeToBounds, translateShape } from "../model/transforms";
import { initialViewport, type Viewport } from "../model/viewport";
import {
  IDENTITY,
  applyWorldTransformToNode,
  invertMatrix,
  multiply,
  nodeWorldMatrix,
  translation as translationMatrix,
} from "../model/matrix";
import {
  childIdsOf,
  descendantNodeIds,
  descendantShapeIds,
  instanceIdsOf,
  isGroup,
  isInstance,
  isNodeHidden,
  isNodeLocked,
  isShape,
  parentIdOf,
  referencedSymbolIds,
  scopeRootGroupId,
  scopeRootIds,
  selectionRoots,
  withChildIds,
  wouldCreateSymbolCycle,
} from "../model/scene";
import { symbolContentBounds } from "../model/bounds";
import type { SymbolInstance } from "../model/types";

export type ToolId = "select" | "node" | "rect" | "ellipse" | "line" | "pen" | "pencil";
export interface EditNode { shapeId: string; sub: number; index: number }
export type AlignType = "left" | "hcenter" | "right" | "top" | "vmiddle" | "bottom";
export interface StyleDefaults { fill: string | null; stroke: string | null; strokeWidth: number }
interface HistoryState { past: Document[]; future: Document[] }
interface ClipboardPayload { nodes: Record<string, SceneNode>; rootIds: string[] }

export interface StyleStylableFields {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  blendMode: BlendMode | undefined;
  transform: Shape["transform"];
  transformOrigin: Vec2 | null;
}

export interface EditorState {
  doc: Document;
  selection: string[];
  selectionPivot: Vec2 | null;
  selectionTransform: Matrix | null;
  /** Symbol edit-mode stack (local view); last entry is the one being edited. */
  editingSymbols: string[];
  tool: ToolId;
  viewport: Viewport;
  style: StyleDefaults;
  history: HistoryState;
  editNode: EditNode | null;
  snapEnabled: boolean;
  gridSnap: boolean;
  gridSize: number;
  recentColors: string[];
  savedSwatches: string[];
  clipboard: ClipboardPayload | null;
  _pending: Document | null;
  _dirty: boolean;

  setTool: (tool: ToolId) => void;
  setViewport: (vp: Viewport) => void;
  setSelection: (ids: string[]) => void;
  setSelectionPivot: (pivot: Vec2 | null) => void;
  setSelectionTransform: (transform: Matrix | null) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  selectAll: () => void;
  setEditNode: (node: EditNode | null) => void;
  deleteEditNode: () => void;
  toggleSnap: () => void;
  toggleGridSnap: () => void;
  setGridSize: (size: number) => void;
  addRecentColor: (hex: string) => void;
  addSwatch: (hex: string) => void;
  removeSwatch: (hex: string) => void;
  setStyle: (patch: Partial<StyleDefaults>) => void;
  newDocument: () => void;
  loadDocument: (doc: Document) => void;
  copySelected: () => void;
  cutSelected: () => void;
  paste: (at?: Vec2) => void;
  duplicateSelected: () => void;
  addShape: (shape: Shape, select?: boolean) => void;
  addShapes: (shapes: Shape[], select?: boolean) => void;
  updateShape: (shape: Shape, select?: boolean) => void;
  toggleNodeSmooth: (shapeId: string, sub: number, index: number) => void;
  applyScriptChanges: (changes: { created: Shape[]; updated: Shape[]; deleted: string[] }) => void;
  deleteSelected: () => void;
  updateSelectedStyle: (patch: Partial<StyleStylableFields>) => void;
  setShapeGeometry: (id: string, patch: Partial<{ x: number; y: number; width: number; height: number }>) => void;
  bringToFront: () => void;
  sendToBack: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  alignSelected: (type: AlignType) => void;
  distributeSelected: (axis: "h" | "v") => void;
  setClosedSelected: (closed: boolean) => void;
  outlineStrokeSelected: () => void;
  booleanSelected: (op: BoolOp) => void;
  makeCompoundPathSelected: () => void;
  releaseCompoundPathSelected: () => void;
  toggleHidden: (id: string) => void;
  toggleLocked: (id: string) => void;
  renameShape: (id: string, name: string) => void;
  renameGroup: (id: string, name: string) => void;
  updateGroupStyle: (id: string, patch: Partial<Pick<Group, "opacity" | "blendMode" | "hidden" | "locked" | "transform" | "transformOrigin">>) => void;
  moveNode: (id: string, parentId: string | null, index: number) => void;
  renameNode: (id: string, name: string) => void;
  createSymbolFromSelection: () => void;
  placeSymbolInstance: (symbolId: string, at?: Vec2) => void;
  detachSelectedInstances: () => void;
  enterSymbolEdit: (symbolId: string) => void;
  exitSymbolEdit: () => void;
  renameSymbol: (symbolId: string, name: string) => void;
  deleteSymbol: (symbolId: string) => void;
  beginInteraction: () => void;
  applyShapes: (next: Record<string, SceneNode>) => void;
  setDoc: (doc: Document) => void;
  endInteraction: () => void;
  undo: () => void;
  redo: () => void;
}

const HISTORY_LIMIT = 100;
const PASTE_OFFSET = 12;
const RECENT_COLORS_KEY = "vinegar.recentColors";
const RECENT_COLORS_MAX = 12;
const SAVED_SWATCHES_KEY = "vinegar.savedSwatches";

function loadColorList(key: string, max = Infinity): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(raw) ? raw.filter((c) => typeof c === "string").slice(0, max) : [];
  } catch { return []; }
}
function saveColorList(key: string, list: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage is optional */ }
}
function clone(doc: Document): Document { return structuredClone(doc); }

function replaceChildren(doc: Document, parentId: string | null, ids: string[]): Document {
  return withChildIds(doc, parentId, ids);
}

function removeRoots(doc: Document, roots: string[]): Document {
  const remove = new Set(roots.flatMap((id) => [id, ...descendantNodeIds(doc, id)]));
  let next = doc;
  const parents = new Set(roots.map((id) => parentIdOf(doc, id)));
  for (const parent of parents) next = replaceChildren(next, parent, childIdsOf(next, parent).filter((id) => !remove.has(id)));
  const nodes = { ...next.nodes };
  for (const id of remove) delete nodes[id];
  return { ...next, nodes };
}

function copyPayload(doc: Document, selection: string[]): ClipboardPayload | null {
  const roots = selectionRoots(doc, selection);
  if (!roots.length) return null;
  const ids = new Set(roots.flatMap((id) => [id, ...descendantNodeIds(doc, id)]));
  const nodes: Record<string, SceneNode> = {};
  for (const id of ids) nodes[id] = structuredClone(doc.nodes[id]);
  for (const id of roots) nodes[id] = { ...nodes[id], transform: nodeWorldMatrix(doc, id) };
  return { nodes, rootIds: roots };
}

function remapPayload(payload: ClipboardPayload, offset = 0): ClipboardPayload {
  const ids = new Map(Object.keys(payload.nodes).map((id) => [id, makeId(payload.nodes[id].type)]));
  const roots = new Set(payload.rootIds);
  const nodes: Record<string, SceneNode> = {};
  for (const [oldId, node] of Object.entries(payload.nodes)) {
    const id = ids.get(oldId)!;
    let next: SceneNode = { ...structuredClone(node), id };
    if (isGroup(next)) next = { ...next, childIds: next.childIds.map((child) => ids.get(child)!) };
    if (offset && roots.has(oldId)) next = { ...next, transform: multiply(translationMatrix(offset, offset), next.transform) };
    nodes[id] = next;
  }
  return { nodes, rootIds: payload.rootIds.map((id) => ids.get(id)!) };
}

function groupNode(id: string, childIds: string[]): Group {
  return { id, name: "Group", type: "group", childIds, transform: [...IDENTITY], transformOrigin: null, opacity: 1 };
}

/** The symbol whose definition is being edited, or null for the scene. */
export function currentSymbolScope(
  s: Pick<EditorState, "editingSymbols">
): string | null {
  return s.editingSymbols[s.editingSymbols.length - 1] ?? null;
}

/** Append nodes as new top-most children of the current editing scope. */
function appendToScope(doc: Document, scope: string | null, ids: string[]): Document {
  const parent = scopeRootGroupId(doc, scope);
  return withChildIds(doc, parent, [...childIdsOf(doc, parent), ...ids]);
}

function instanceNode(id: string, symbolId: string, transform: Matrix): SymbolInstance {
  return {
    id,
    name: "Instance",
    type: "instance",
    symbolId,
    transform,
    transformOrigin: null,
    opacity: 1,
  };
}

interface AlignItem { id: string; bounds: Bounds }
function selectionItems(doc: Document, selection: string[]): AlignItem[] {
  return selectionRoots(doc, selection).flatMap((id) => {
    const bounds = nodeWorldBounds(doc, id);
    return bounds ? [{ id, bounds }] : [];
  });
}

export const useEditor = create<EditorState>((set, get) => {
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
  const clearTransient = { selectionPivot: null, selectionTransform: null };

  return {
    doc: createEmptyDocument(), selection: [], selectionPivot: null, selectionTransform: null,
    editingSymbols: [],
    tool: "select", viewport: initialViewport,
    style: { fill: "#4f8cff", stroke: "#1b1b1b", strokeWidth: 2 },
    history: { past: [], future: [] }, editNode: null, snapEnabled: true,
    gridSnap: false, gridSize: 50,
    recentColors: loadColorList(RECENT_COLORS_KEY, RECENT_COLORS_MAX),
    savedSwatches: loadColorList(SAVED_SWATCHES_KEY), clipboard: null,
    _pending: null, _dirty: false,

    setTool: (tool) => set({ tool, selection: tool === "select" || tool === "node" ? get().selection : [], ...(tool === "select" || tool === "node" ? {} : clearTransient), editNode: null }),
    setViewport: (viewport) => set({ viewport }),
    setSelection: (selection) => set({ selection: [...new Set(selection)].filter((id) => !!get().doc.nodes[id]), ...clearTransient }),
    setSelectionPivot: (selectionPivot) => set({ selectionPivot }),
    setSelectionTransform: (selectionTransform) => set({ selectionTransform }),
    toggleSelection: (id) => set({ selection: get().selection.includes(id) ? get().selection.filter((x) => x !== id) : [...get().selection, id], ...clearTransient }),
    clearSelection: () => set({ selection: [], editNode: null, ...clearTransient }),
    selectAll: () => { const s = get(); const roots = scopeRootIds(s.doc, currentSymbolScope(s)); set({ selection: roots.filter((id) => !isNodeHidden(s.doc, id) && !isNodeLocked(s.doc, id)), ...clearTransient }); },
    setEditNode: (editNode) => set({ editNode }),
    toggleSnap: () => set({ snapEnabled: !get().snapEnabled }),
    toggleGridSnap: () => set({ gridSnap: !get().gridSnap }),
    setGridSize: (size) => { const gridSize = Math.max(1, Math.round(size)); const doc = get().doc; set({ gridSize, doc: { ...doc, settings: { ...doc.settings, gridSize } } }); },
    addRecentColor: (hex) => { const c = hex.toLowerCase(); const recentColors = [c, ...get().recentColors.filter((x) => x !== c)].slice(0, RECENT_COLORS_MAX); saveColorList(RECENT_COLORS_KEY, recentColors); set({ recentColors }); },
    addSwatch: (hex) => { const c = hex.toLowerCase(); if (get().savedSwatches.includes(c)) return; const savedSwatches = [...get().savedSwatches, c]; saveColorList(SAVED_SWATCHES_KEY, savedSwatches); set({ savedSwatches }); },
    removeSwatch: (hex) => { const savedSwatches = get().savedSwatches.filter((x) => x !== hex.toLowerCase()); saveColorList(SAVED_SWATCHES_KEY, savedSwatches); set({ savedSwatches }); },
    setStyle: (patch) => set({ style: { ...get().style, ...patch } }),

    newDocument: () => { const doc = createEmptyDocument(); set({ doc, gridSize: doc.settings.gridSize, selection: [], editingSymbols: [], history: { past: [], future: [] }, _pending: null, _dirty: false, ...clearTransient }); },
    loadDocument: (doc) => set({ doc, gridSize: doc.settings.gridSize, selection: [], editingSymbols: [], history: { past: [], future: [] }, _pending: null, _dirty: false, ...clearTransient }),

    addShape: (shape, select = true) => { const s = get(); const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } }; transact(appendToScope(doc, currentSymbolScope(s), [shape.id])); if (select) set({ selection: [shape.id], ...clearTransient }); },
    addShapes: (shapes, select = true) => { if (!shapes.length) return; const s = get(); const doc = { ...s.doc, nodes: { ...s.doc.nodes, ...Object.fromEntries(shapes.map((sh) => [sh.id, sh])) } }; transact(appendToScope(doc, currentSymbolScope(s), shapes.map((sh) => sh.id))); if (select) set({ selection: shapes.map((sh) => sh.id), ...clearTransient }); },
    updateShape: (shape, select = true) => { const doc = get().doc; if (!isShape(doc.nodes[shape.id])) return; transact({ ...doc, nodes: { ...doc.nodes, [shape.id]: shape } }); if (select) set({ selection: [shape.id], ...clearTransient }); },
    toggleNodeSmooth: (id, sub, index) => { const doc = get().doc; const shape = doc.nodes[id]; if (!isShape(shape) || shape.type !== "bezier") return; transact({ ...doc, nodes: { ...doc.nodes, [id]: toggleAnchorSmooth(shape, sub, index) } }); },
    deleteEditNode: () => {
      const { doc, editNode } = get(); if (!editNode) return;
      const shape = doc.nodes[editNode.shapeId]; if (!isShape(shape) || shape.type !== "bezier") return;
      const sp = shape.subpaths[editNode.sub]; if (!sp) return;
      const anchors = sp.anchors.filter((_, i) => i !== editNode.index);
      // A subpath that can no longer form a segment disappears with its anchor.
      const subpaths = anchors.length < 2
        ? shape.subpaths.filter((_, i) => i !== editNode.sub)
        : shape.subpaths.map((s, i) => (i === editNode.sub ? { ...s, anchors } : s));
      if (subpaths.length === 0) { transact(removeRoots(doc, [shape.id])); set({ selection: [], editNode: null, ...clearTransient }); }
      else { transact({ ...doc, nodes: { ...doc.nodes, [shape.id]: { ...shape, subpaths } } }); set({ editNode: null }); }
    },
    applyScriptChanges: ({ created, updated, deleted }) => {
      let doc = get().doc; const del = new Set(deleted);
      for (const id of deleted) if (isShape(doc.nodes[id])) doc = removeRoots(doc, [id]);
      const nodes = { ...doc.nodes };
      for (const shape of updated) if (!del.has(shape.id) && isShape(nodes[shape.id])) nodes[shape.id] = shape;
      for (const shape of created) nodes[shape.id] = shape;
      doc = { ...doc, nodes, rootIds: [...doc.rootIds, ...created.map((s) => s.id)] };
      transact(doc); set({ selection: [...updated.filter((s) => !del.has(s.id)).map((s) => s.id), ...created.map((s) => s.id)], ...clearTransient });
    },

    deleteSelected: () => { const roots = selectionRoots(get().doc, get().selection); if (!roots.length) return; transact(removeRoots(get().doc, roots)); set({ selection: [], ...clearTransient }); },
    copySelected: () => set({ clipboard: copyPayload(get().doc, get().selection) }),
    cutSelected: () => { get().copySelected(); get().deleteSelected(); },
    paste: (at) => {
      const state = get(); const { clipboard, doc } = state; if (!clipboard) return;
      // Instances only paste while their symbol exists and no cycle results.
      const symbolIds = referencedSymbolIds(Object.values(clipboard.nodes));
      for (const symbolId of symbolIds) if (!doc.symbols[symbolId]) return;
      const scope = currentSymbolScope(state);
      if (wouldCreateSymbolCycle(doc, scope, symbolIds)) return;
      const pasted = remapPayload(clipboard, at ? 0 : PASTE_OFFSET);
      if (at) {
        const temp: Document = { ...doc, nodes: { ...doc.nodes, ...pasted.nodes }, rootIds: pasted.rootIds };
        const bounds = unionNodeWorldBounds(temp, pasted.rootIds);
        if (bounds) { const dx = at.x - bounds.x - bounds.width / 2; const dy = at.y - bounds.y - bounds.height / 2; for (const id of pasted.rootIds) pasted.nodes[id] = { ...pasted.nodes[id], transform: multiply(translationMatrix(dx, dy), pasted.nodes[id].transform) }; }
      }
      transact(appendToScope({ ...doc, nodes: { ...doc.nodes, ...pasted.nodes } }, scope, pasted.rootIds));
      set({ selection: pasted.rootIds, ...clearTransient });
    },
    duplicateSelected: () => {
      const { doc, selection } = get(); const roots = selectionRoots(doc, selection); if (!roots.length) return;
      const selectedByParent = new Map<string | null, string[]>();
      for (const id of roots) { const p = parentIdOf(doc, id); selectedByParent.set(p, [...(selectedByParent.get(p) ?? []), id]); }
      let next = doc; const allNew: string[] = [];
      for (const [parent, selected] of selectedByParent) {
        const raw = copyPayload(doc, selected)!;
        for (const id of raw.rootIds) raw.nodes[id] = { ...raw.nodes[id], transform: structuredClone(doc.nodes[id].transform) };
        const dup = remapPayload(raw);
        next = { ...next, nodes: { ...next.nodes, ...dup.nodes } };
        const oldToNew = new Map(selected.map((id, i) => [id, dup.rootIds[i]]));
        const siblings = childIdsOf(next, parent); const reordered: string[] = [];
        for (const id of siblings) { reordered.push(id); const copy = oldToNew.get(id); if (copy) reordered.push(copy); }
        next = replaceChildren(next, parent, reordered);
        const moved = { ...next.nodes };
        for (const id of dup.rootIds) moved[id] = applyWorldTransformToNode(next, moved[id], translationMatrix(PASTE_OFFSET, PASTE_OFFSET));
        next = { ...next, nodes: moved }; allNew.push(...dup.rootIds);
      }
      transact(next); set({ selection: allNew, ...clearTransient });
    },

    updateSelectedStyle: (patch) => {
      const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false;
      for (const root of selectionRoots(doc, get().selection)) {
        const ids = isShape(nodes[root]) ? [root] : descendantShapeIds(doc, root);
        for (const id of ids) { nodes[id] = { ...(nodes[id] as Shape), ...patch } as Shape; changed = true; }
      }
      if (changed) transact({ ...doc, nodes }, "style:" + Object.keys(patch).sort().join(","));
    },
    setShapeGeometry: (id, patch) => { const doc = get().doc; const shape = doc.nodes[id]; if (!isShape(shape)) return; const b = shapeBounds(shape); let next = resizeShapeToBounds(shape, b, { x: b.x, y: b.y, width: Math.max(1, patch.width ?? b.width), height: Math.max(1, patch.height ?? b.height) }); next = translateShape(next, (patch.x ?? b.x) - b.x, (patch.y ?? b.y) - b.y); transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, "geom:" + id); },
    bringToFront: () => { let doc = get().doc; const roots = selectionRoots(doc, get().selection); for (const parent of new Set(roots.map((id) => parentIdOf(doc, id)))) { const selected = new Set(roots.filter((id) => parentIdOf(doc, id) === parent)); const ids = childIdsOf(doc, parent); doc = replaceChildren(doc, parent, [...ids.filter((id) => !selected.has(id)), ...ids.filter((id) => selected.has(id))]); } transact(doc); },
    sendToBack: () => { let doc = get().doc; const roots = selectionRoots(doc, get().selection); for (const parent of new Set(roots.map((id) => parentIdOf(doc, id)))) { const selected = new Set(roots.filter((id) => parentIdOf(doc, id) === parent)); const ids = childIdsOf(doc, parent); doc = replaceChildren(doc, parent, [...ids.filter((id) => selected.has(id)), ...ids.filter((id) => !selected.has(id))]); } transact(doc); },
    groupSelected: () => {
      const { doc } = get(); const roots = selectionRoots(doc, get().selection); if (roots.length < 2) return;
      const parent = parentIdOf(doc, roots[0]); if (!roots.every((id) => parentIdOf(doc, id) === parent)) return;
      const selected = new Set(roots); const siblings = childIdsOf(doc, parent); const members = siblings.filter((id) => selected.has(id)); const insert = siblings.indexOf(members[members.length - 1]); const rest = siblings.filter((id) => !selected.has(id)); const below = siblings.slice(0, insert).filter((id) => !selected.has(id)).length;
      const id = makeId("group"); rest.splice(below, 0, id);
      let next = { ...doc, nodes: { ...doc.nodes, [id]: groupNode(id, members) } }; next = replaceChildren(next, parent, rest); transact(next); set({ selection: [id], ...clearTransient });
    },
    ungroupSelected: () => {
      let doc = get().doc; const selected: string[] = [];
      for (const id of selectionRoots(doc, get().selection)) {
        const group = doc.nodes[id]; if (!isGroup(group)) continue;
        const parent = parentIdOf(doc, id); const siblings = childIdsOf(doc, parent); const at = siblings.indexOf(id);
        const nodes = { ...doc.nodes };
        for (const child of group.childIds) {
          const node = nodes[child];
          nodes[child] = {
            ...node,
            transform: multiply(group.transform, node.transform),
            opacity: node.opacity * group.opacity,
            blendMode: node.blendMode ?? group.blendMode,
            hidden: node.hidden || group.hidden || undefined,
            locked: node.locked || group.locked || undefined,
          };
        }
        delete nodes[id];
        doc = { ...doc, nodes }; const order = [...siblings]; order.splice(at, 1, ...group.childIds); doc = replaceChildren(doc, parent, order); selected.push(...group.childIds);
      }
      if (selected.length) { transact(doc); set({ selection: selected, ...clearTransient }); }
    },
    alignSelected: (type) => {
      const doc = get().doc; const items = selectionItems(doc, get().selection); const union = unionNodeWorldBounds(doc, items.map((i) => i.id)); if (items.length < 2 || !union) return; const nodes = { ...doc.nodes };
      for (const item of items) { const b = item.bounds; let dx = 0, dy = 0; if (type === "left") dx = union.x - b.x; if (type === "hcenter") dx = union.x + union.width / 2 - b.x - b.width / 2; if (type === "right") dx = union.x + union.width - b.x - b.width; if (type === "top") dy = union.y - b.y; if (type === "vmiddle") dy = union.y + union.height / 2 - b.y - b.height / 2; if (type === "bottom") dy = union.y + union.height - b.y - b.height; if (dx || dy) nodes[item.id] = applyWorldTransformToNode(doc, nodes[item.id], translationMatrix(dx, dy)); }
      transact({ ...doc, nodes }); set(clearTransient);
    },
    distributeSelected: (axis) => {
      const doc = get().doc; const items = selectionItems(doc, get().selection); if (items.length < 3) return; const horizontal = axis === "h"; const start = (b: Bounds) => horizontal ? b.x : b.y; const size = (b: Bounds) => horizontal ? b.width : b.height; const sorted = [...items].sort((a, b) => start(a.bounds) - start(b.bounds)); const last = sorted[sorted.length - 1]; const span = start(last.bounds) + size(last.bounds) - start(sorted[0].bounds); const gap = (span - sorted.reduce((n, x) => n + size(x.bounds), 0)) / (sorted.length - 1); const nodes = { ...doc.nodes }; let cursor = start(sorted[0].bounds) + size(sorted[0].bounds) + gap;
      for (const item of sorted.slice(1, -1)) { const d = cursor - start(item.bounds); nodes[item.id] = applyWorldTransformToNode(doc, nodes[item.id], translationMatrix(horizontal ? d : 0, horizontal ? 0 : d)); cursor += size(item.bounds) + gap; }
      transact({ ...doc, nodes }); set(clearTransient);
    },
    setClosedSelected: (closed) => { const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false; for (const id of selectionRoots(doc, get().selection)) { const shape = nodes[id]; if (!isShape(shape)) continue; if (shape.type === "path" && shape.closed !== closed) { nodes[id] = { ...shape, closed }; changed = true; } else if (shape.type === "bezier" && shape.subpaths.some((sp) => sp.closed !== closed)) { nodes[id] = { ...shape, subpaths: shape.subpaths.map((sp) => ({ ...sp, closed })) }; changed = true; } } if (changed) transact({ ...doc, nodes }); },
    outlineStrokeSelected: () => {
      let doc = get().doc; const selected: string[] = [];
      for (const id of selectionRoots(doc, get().selection)) {
        const shape = doc.nodes[id]; if (!isShape(shape) || !shape.stroke || shape.strokeWidth <= 0) continue;
        const polys = strokeOutline(shape); if (!polys?.length) continue;
        const outline: Shape = { id: makeId("polygon"), name: "Outline", type: "polygon", polys, fill: shape.stroke, stroke: null, strokeWidth: 0, opacity: shape.opacity, blendMode: shape.blendMode, transform: [...IDENTITY], transformOrigin: null };
        const parent = parentIdOf(doc, id); const siblings = childIdsOf(doc, parent); const at = siblings.indexOf(id); const nodes = { ...doc.nodes };
        if (isAreal(shape) && shape.fill) { const gid = makeId("group"); nodes[id] = { ...shape, stroke: null }; nodes[outline.id] = outline; nodes[gid] = groupNode(gid, [id, outline.id]); const order = [...siblings]; order.splice(at, 1, gid); doc = replaceChildren({ ...doc, nodes }, parent, order); selected.push(gid); }
        else { delete nodes[id]; nodes[outline.id] = outline; const order = [...siblings]; order.splice(at, 1, outline.id); doc = replaceChildren({ ...doc, nodes }, parent, order); selected.push(outline.id); }
      }
      if (selected.length) { transact(doc); set({ selection: selected, ...clearTransient }); }
    },
    booleanSelected: (op) => {
      const doc = get().doc; const roots = selectionRoots(doc, get().selection); if (roots.length < 2 || !roots.every((id) => isShape(doc.nodes[id]))) return; const parent = parentIdOf(doc, roots[0]); if (!roots.every((id) => parentIdOf(doc, id) === parent)) return; const siblings = childIdsOf(doc, parent); const selected = new Set(roots); const ordered = siblings.filter((id) => selected.has(id)); const result = booleanShapes(ordered.map((id) => doc.nodes[id] as Shape), op); if (!result) return; const nodes = { ...doc.nodes }; for (const id of roots) delete nodes[id]; nodes[result.id] = result; const order = siblings.filter((id) => !selected.has(id)); order.splice(siblings.slice(0, siblings.indexOf(ordered[0])).filter((id) => !selected.has(id)).length, 0, result.id); let next = replaceChildren({ ...doc, nodes }, parent, order); transact(next); set({ selection: [result.id], ...clearTransient });
    },
    makeCompoundPathSelected: () => {
      const doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (!canMakeCompoundPathSelection(doc, roots)) return;
      const parent = parentIdOf(doc, roots[0]);
      const siblings = childIdsOf(doc, parent);
      const selected = new Set(roots);
      const ordered = siblings.filter((id) => selected.has(id));
      const compound = makeCompoundPath(ordered.map((id) => doc.nodes[id] as Shape));
      if (!compound) return;
      const nodes = { ...doc.nodes };
      for (const id of ordered) delete nodes[id];
      nodes[compound.id] = compound;
      const order = siblings.filter((id) => !selected.has(id));
      const at = siblings.slice(0, siblings.indexOf(ordered[0])).filter((id) => !selected.has(id)).length;
      order.splice(at, 0, compound.id);
      const next = replaceChildren({ ...doc, nodes }, parent, order);
      transact(next);
      set({ selection: [compound.id], editNode: null, ...clearTransient });
    },
    releaseCompoundPathSelected: () => {
      let doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (!canReleaseCompoundPathSelection(doc, roots)) return;
      const selected: string[] = [];
      for (const id of roots) {
        const compound = doc.nodes[id];
        if (!compound || compound.type !== "compoundPath") continue;
        const parent = parentIdOf(doc, id);
        const siblings = childIdsOf(doc, parent);
        const at = siblings.indexOf(id);
        const released = releaseCompoundPath(compound);
        const nodes = { ...doc.nodes };
        delete nodes[id];
        for (const shape of released) nodes[shape.id] = shape;
        const order = [...siblings];
        order.splice(at, 1, ...released.map((shape) => shape.id));
        doc = replaceChildren({ ...doc, nodes }, parent, order);
        selected.push(...released.map((shape) => shape.id));
      }
      if (selected.length) {
        transact(doc);
        set({ selection: selected, editNode: null, ...clearTransient });
      }
    },
    toggleHidden: (id) => { const doc = get().doc, node = doc.nodes[id]; if (!node) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, hidden: !node.hidden } } }); if (!node.hidden) { const affected = new Set([id, ...descendantNodeIds(doc, id)]); set({ selection: get().selection.filter((x) => !affected.has(x)), ...clearTransient }); } },
    toggleLocked: (id) => { const doc = get().doc, node = doc.nodes[id]; if (!node) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, locked: !node.locked } } }); if (!node.locked) { const affected = new Set([id, ...descendantNodeIds(doc, id)]); set({ selection: get().selection.filter((x) => !affected.has(x)), ...clearTransient }); } },
    renameShape: (id, name) => { const doc = get().doc, node = doc.nodes[id]; if (!isShape(node)) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, name } } }); },
    renameGroup: (id, name) => { const doc = get().doc, node = doc.nodes[id]; if (!isGroup(node)) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, name } } }); },
    updateGroupStyle: (id, patch) => { const doc = get().doc, node = doc.nodes[id]; if (!isGroup(node)) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, ...patch } } }, "gstyle:" + id + ":" + Object.keys(patch).sort().join(",")); if (patch.hidden || patch.locked) { const affected = new Set([id, ...descendantNodeIds(doc, id)]); set({ selection: get().selection.filter((x) => !affected.has(x)), ...clearTransient }); } },
    moveNode: (id, parent, index) => {
      const doc = get().doc;
      const node = doc.nodes[id];
      if (!node || (parent !== null && !isGroup(doc.nodes[parent]))) return;
      if (parent === id || descendantNodeIds(doc, id).includes(parent ?? "")) return;

      const oldParent = parentIdOf(doc, id);
      const oldWorld = nodeWorldMatrix(doc, id);
      const targetWorld = nodeWorldMatrix(doc, parent);
      const inverseTarget = invertMatrix(targetWorld);
      if (!inverseTarget) return;

      let next = replaceChildren(
        doc,
        oldParent,
        childIdsOf(doc, oldParent).filter((child) => child !== id)
      );
      const targetChildren = childIdsOf(next, parent).filter((child) => child !== id);
      const at = Math.max(0, Math.min(Math.trunc(index), targetChildren.length));
      targetChildren.splice(at, 0, id);
      if (
        oldParent === parent &&
        targetChildren.every((child, i) => childIdsOf(doc, parent)[i] === child)
      ) return;
      next = replaceChildren(next, parent, targetChildren);
      next = {
        ...next,
        nodes: {
          ...next.nodes,
          [id]: { ...node, transform: multiply(inverseTarget, oldWorld) },
        },
      };

      transact(next);
    },
    renameNode: (id, name) => { const doc = get().doc, node = doc.nodes[id]; if (!node) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, name } } }); },
    createSymbolFromSelection: () => {
      const s = get(); const doc = s.doc;
      const roots = selectionRoots(doc, s.selection); if (!roots.length) return;
      const parent = parentIdOf(doc, roots[0]);
      if (!roots.every((id) => parentIdOf(doc, id) === parent)) return;
      const selected = new Set(roots);
      const siblings = childIdsOf(doc, parent);
      const members = siblings.filter((id) => selected.has(id));
      const insert = siblings.indexOf(members[members.length - 1]);
      const below = siblings.slice(0, insert).filter((id) => !selected.has(id)).length;
      const rest = siblings.filter((id) => !selected.has(id));
      const symbolId = makeId("symbol");
      const rootId = makeId("group");
      const instId = makeId("instance");
      const name = `Symbol ${Object.keys(doc.symbols).length + 1}`;
      rest.splice(below, 0, instId);
      // Members keep their local transforms; the definition root and the
      // instance are both identity, so the drawing is visually unchanged.
      let next: Document = {
        ...doc,
        nodes: {
          ...doc.nodes,
          [rootId]: { ...groupNode(rootId, members), name },
          [instId]: instanceNode(instId, symbolId, [...IDENTITY]),
        },
        symbols: { ...doc.symbols, [symbolId]: { id: symbolId, name, rootNodeId: rootId } },
      };
      next = replaceChildren(next, parent, rest);
      transact(next); set({ selection: [instId], ...clearTransient });
    },
    placeSymbolInstance: (symbolId, at) => {
      const s = get(); const doc = s.doc;
      if (!doc.symbols[symbolId]) return;
      const scope = currentSymbolScope(s);
      if (wouldCreateSymbolCycle(doc, scope, [symbolId])) return;
      let transform: Matrix = [...IDENTITY];
      if (at) {
        const content = symbolContentBounds(doc, symbolId);
        if (content) transform = translationMatrix(at.x - content.x - content.width / 2, at.y - content.y - content.height / 2);
      }
      const id = makeId("instance");
      const next = appendToScope({ ...doc, nodes: { ...doc.nodes, [id]: instanceNode(id, symbolId, transform) } }, scope, [id]);
      transact(next); set({ selection: [id], ...clearTransient });
    },
    detachSelectedInstances: () => {
      let doc = get().doc; const selected: string[] = [];
      for (const id of selectionRoots(doc, get().selection)) {
        const inst = doc.nodes[id];
        if (!isInstance(inst)) continue;
        const def = doc.symbols[inst.symbolId]; if (!def) continue;
        const contentIds = childIdsOf(doc, def.rootNodeId);
        const all = contentIds.flatMap((cid) => [cid, ...descendantNodeIds(doc, cid)]);
        const payloadNodes: Record<string, SceneNode> = {};
        for (const nid of all) payloadNodes[nid] = structuredClone(doc.nodes[nid]);
        const dup = remapPayload({ nodes: payloadNodes, rootIds: contentIds });
        const gid = makeId("group");
        const group: Group = {
          id: gid, name: def.name, type: "group", childIds: dup.rootIds,
          transform: [...inst.transform], transformOrigin: inst.transformOrigin ? { ...inst.transformOrigin } : null,
          opacity: inst.opacity, blendMode: inst.blendMode, hidden: inst.hidden, locked: inst.locked,
        };
        const parent = parentIdOf(doc, id);
        const siblings = childIdsOf(doc, parent);
        const at = siblings.indexOf(id);
        const nodes = { ...doc.nodes, ...dup.nodes, [gid]: group };
        delete nodes[id];
        const order = [...siblings]; order.splice(at, 1, gid);
        doc = replaceChildren({ ...doc, nodes }, parent, order);
        selected.push(gid);
      }
      if (selected.length) { transact(doc); set({ selection: selected, ...clearTransient }); }
    },
    enterSymbolEdit: (symbolId) => { const s = get(); if (!s.doc.symbols[symbolId] || s.editingSymbols.includes(symbolId)) return; set({ editingSymbols: [...s.editingSymbols, symbolId], selection: [], editNode: null, ...clearTransient }); },
    exitSymbolEdit: () => { const s = get(); if (!s.editingSymbols.length) return; set({ editingSymbols: s.editingSymbols.slice(0, -1), selection: [], editNode: null, ...clearTransient }); },
    renameSymbol: (symbolId, name) => { const doc = get().doc; const def = doc.symbols[symbolId]; if (!def) return; transact({ ...doc, symbols: { ...doc.symbols, [symbolId]: { ...def, name } } }); },
    deleteSymbol: (symbolId) => {
      const s = get(); const doc = s.doc; const def = doc.symbols[symbolId]; if (!def) return;
      if (s.editingSymbols.includes(symbolId)) return;
      if (instanceIdsOf(doc, symbolId).length) return;
      const remove = new Set([def.rootNodeId, ...descendantNodeIds(doc, def.rootNodeId)]);
      const nodes = { ...doc.nodes };
      for (const id of remove) delete nodes[id];
      const symbols = { ...doc.symbols };
      delete symbols[symbolId];
      transact({ ...doc, nodes, symbols });
      set({ selection: get().selection.filter((id) => !remove.has(id)), ...clearTransient });
    },
    beginInteraction: () => set({ _pending: clone(get().doc), _dirty: false }),
    applyShapes: (next) => set({ doc: { ...get().doc, nodes: { ...get().doc.nodes, ...next } }, _dirty: true }),
    setDoc: (doc) => set({ doc, _dirty: true }),
    endInteraction: () => { resetCoalesce(); const { _pending, _dirty, history } = get(); if (_pending && _dirty) set({ history: { past: [...history.past, _pending].slice(-HISTORY_LIMIT), future: [] } }); set({ _pending: null, _dirty: false }); },
    undo: () => { resetCoalesce(); const { history, doc } = get(); if (!history.past.length) return; const past = [...history.past], prev = past.pop()!; set({ doc: prev, history: { past, future: [clone(doc), ...history.future] }, selection: get().selection.filter((id) => !!prev.nodes[id]), editingSymbols: get().editingSymbols.filter((id) => !!prev.symbols[id]), ...clearTransient }); },
    redo: () => { resetCoalesce(); const { history, doc } = get(); if (!history.future.length) return; const [next, ...future] = history.future; set({ doc: next, history: { past: [...history.past, clone(doc)], future }, selection: get().selection.filter((id) => !!next.nodes[id]), editingSymbols: get().editingSymbols.filter((id) => !!next.symbols[id]), ...clearTransient }); },
  };
});

export function styleFromDefaults(style: StyleDefaults) {
  return { fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth, opacity: 1, transform: [...IDENTITY] as Shape["transform"], transformOrigin: null };
}
