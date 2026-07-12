// Creating and mutating individual shapes (geometry, style, bezier anchors).

import { toggleAnchorSmooth } from "../model/bezier";
import { shapeBounds } from "../model/bounds";
import { descendantShapeIds, isShape, selectionRoots } from "../model/scene";
import { resizeShapeToBounds, translateShape } from "../model/transforms";
import type { Shape } from "../model/types";
import { appendToScope, removeRoots } from "./docOps";
import {
  clearTransient,
  currentSymbolScope,
  type ShapeActions,
  type StoreCtx,
} from "./state";

export function createShapeActions({ set, get, transact }: StoreCtx): ShapeActions {
  return {
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
    // Scripts operate on the scene scope; created shapes join the scene roots.
    applyScriptChanges: ({ created, updated, deleted }) => {
      let doc = get().doc; const del = new Set(deleted);
      for (const id of deleted) if (isShape(doc.nodes[id])) doc = removeRoots(doc, [id]);
      const nodes = { ...doc.nodes };
      for (const shape of updated) if (!del.has(shape.id) && isShape(nodes[shape.id])) nodes[shape.id] = shape;
      for (const shape of created) nodes[shape.id] = shape;
      doc = { ...doc, nodes, rootIds: [...doc.rootIds, ...created.map((s) => s.id)] };
      transact(doc); set({ selection: [...updated.filter((s) => !del.has(s.id)).map((s) => s.id), ...created.map((s) => s.id)], ...clearTransient });
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
    setClosedSelected: (closed) => { const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false; for (const id of selectionRoots(doc, get().selection)) { const shape = nodes[id]; if (!isShape(shape)) continue; if (shape.type === "path" && shape.closed !== closed) { nodes[id] = { ...shape, closed }; changed = true; } else if (shape.type === "bezier" && shape.subpaths.some((sp) => sp.closed !== closed)) { nodes[id] = { ...shape, subpaths: shape.subpaths.map((sp) => ({ ...sp, closed })) }; changed = true; } } if (changed) transact({ ...doc, nodes }); },
  };
}
