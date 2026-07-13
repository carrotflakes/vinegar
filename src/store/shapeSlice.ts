// Creating and mutating individual shapes (geometry, style, bezier anchors).

import { toggleAnchorSmooth } from "../model/bezier";
import { shapeBounds } from "../model/bounds";
import { descendantShapeIds, isShape, selectionRoots } from "../model/scene";
import { resizeShapeToBounds, translateShape } from "../model/transforms";
import { makeId, type ImageShape, type Shape } from "../model/types";
import { importImageFile, isImageFile } from "../io/importImage";
import { measureTextShape } from "../canvas/textLayout";
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
    updateTextShape: (id, patch) => {
      const doc = get().doc; const shape = doc.nodes[id];
      if (!isShape(shape) || shape.type !== "text") return;
      const next = measureTextShape({ ...shape, ...patch });
      transact(
        { ...doc, nodes: { ...doc.nodes, [id]: next } },
        `text:${id}:${Object.keys(patch).sort().join(",")}`
      );
    },
    remeasureTextShapes: () => {
      const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false;
      for (const [id, node] of Object.entries(nodes)) {
        if (!isShape(node) || node.type !== "text") continue;
        const next = measureTextShape(node);
        if (next.width !== node.width || next.height !== node.height) {
          nodes[id] = next; changed = true;
        }
      }
      if (changed) set({ doc: { ...doc, nodes } });
    },
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
    placeImageFiles: async (files, at, fitWithin) => {
      const images = (
        await Promise.all(files.filter(isImageFile).map(importImageFile))
      ).filter((img) => img !== null);
      if (!images.length) return;
      const s = get();
      const nodes = { ...s.doc.nodes };
      const assets = { ...s.doc.assets };
      const ids: string[] = [];
      // Multiple files land as a small cascade so none hides the others.
      images.forEach((img, i) => {
        const scale = fitWithin
          ? Math.min(1, fitWithin.width / img.naturalWidth, fitWithin.height / img.naturalHeight)
          : 1;
        const width = img.naturalWidth * scale;
        const height = img.naturalHeight * scale;
        const shape: ImageShape = {
          id: makeId("image"),
          name: img.asset.name?.replace(/\.[^.]+$/, "") || "Image",
          type: "image",
          assetId: img.asset.id,
          x: at.x - width / 2 + i * 24,
          y: at.y - height / 2 + i * 24,
          width,
          height,
          transform: [1, 0, 0, 1, 0, 0],
          transformOrigin: null,
          opacity: 1,
          fill: null,
          stroke: null,
          strokeWidth: 0,
        };
        assets[img.asset.id] = img.asset;
        nodes[shape.id] = shape;
        ids.push(shape.id);
      });
      const doc = { ...s.doc, nodes, assets };
      transact(appendToScope(doc, currentSymbolScope(s), ids));
      set({ selection: ids, ...clearTransient });
    },
    addPatternImage: async (file) => {
      if (!isImageFile(file)) return null;
      const img = await importImageFile(file);
      if (!img) return null;
      const s = get();
      transact({ ...s.doc, assets: { ...s.doc.assets, [img.asset.id]: img.asset } });
      return img.asset.id;
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
    setShapeGeometry: (id, patch) => { const doc = get().doc; const shape = doc.nodes[id]; if (!isShape(shape)) return; const b = shapeBounds(shape); if (shape.type === "text") { const moved = translateShape(shape, (patch.x ?? b.x) - b.x, (patch.y ?? b.y) - b.y); if (moved.type !== "text") return; const next = measureTextShape({ ...moved, width: shape.textMode === "area" ? Math.max(1, patch.width ?? shape.width) : shape.width }); transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, "geom:" + id); return; } let next = resizeShapeToBounds(shape, b, { x: b.x, y: b.y, width: Math.max(1, patch.width ?? b.width), height: Math.max(1, patch.height ?? b.height) }); next = translateShape(next, (patch.x ?? b.x) - b.x, (patch.y ?? b.y) - b.y); transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, "geom:" + id); },
    setImageLockAspect: (id, lock) => { const doc = get().doc; const shape = doc.nodes[id]; if (!isShape(shape) || shape.type !== "image") return; const next = { ...shape, lockAspect: lock || undefined }; transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, "lockAspect:" + id); },
    setClosedSelected: (closed) => { const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false; for (const id of selectionRoots(doc, get().selection)) { const shape = nodes[id]; if (!isShape(shape)) continue; if (shape.type === "path" && shape.closed !== closed) { nodes[id] = { ...shape, closed }; changed = true; } else if (shape.type === "bezier" && shape.subpaths.some((sp) => sp.closed !== closed)) { nodes[id] = { ...shape, subpaths: shape.subpaths.map((sp) => ({ ...sp, closed })) }; changed = true; } } if (changed) transact({ ...doc, nodes }); },
  };
}
