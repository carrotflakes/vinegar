// Creating and mutating individual shapes (geometry, style, bezier anchors).

import { toggleAnchorSmooth } from "../model/bezier";
import { deleteBrushAnchor, toggleBrushAnchorSmooth } from "../model/brushEdit";
import { expandBounds, intersectBounds, shapeBounds, unionNodeWorldBounds, worldShapeBounds } from "../model/bounds";
import { hasValidClippingMasks } from "../model/clippingMask";
import { eraseBrush } from "../model/eraser";
import { multiply, shapeWorldMatrix, translation } from "../model/matrix";
import { childIdsOf, descendantShapeIds, isGroup, isNodeHidden, isNodeLocked, isShape, parentIdOf, referencedAssetIds, scopeLeafIds, selectionRoots, withChildIds } from "../model/scene";
import { clampRectCornerRadius } from "../model/roundedRect";
import { resizeShapeToBounds, translateShape } from "../model/transforms";
import { makeId, type Bounds, type ImageShape, type SceneNode, type Shape, type Vec2 } from "../model/types";
import { importImageFile, isImageFile } from "../io/importImage";
import { measureTextShape } from "../canvas/textLayout";
import { loadAssetImage } from "../canvas/imageCache";
import { appendToScope, groupNode, removeRoots } from "./docOps";
import {
  clearTransient,
  currentSymbolScope,
  type ShapeActions,
  type StoreCtx,
} from "./state";

/** Axis-aligned bounds of a point list (eraser path). */
function pathBounds(pts: Vec2[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function createShapeActions({ set, get, transact, replaceDocumentWithoutHistory }: StoreCtx): ShapeActions {
  return {
    addShape: (shape, select = true) => { const s = get(); const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } }; transact(appendToScope(doc, currentSymbolScope(s), [shape.id])); if (select) set({ selection: [shape.id], ...clearTransient }); },
    addShapes: (shapes, select = true) => { if (!shapes.length) return; const s = get(); const doc = { ...s.doc, nodes: { ...s.doc.nodes, ...Object.fromEntries(shapes.map((sh) => [sh.id, sh])) } }; transact(appendToScope(doc, currentSymbolScope(s), shapes.map((sh) => sh.id))); if (select) set({ selection: shapes.map((sh) => sh.id), ...clearTransient }); },
    addBrushStroke: (shape) => {
      const s = get();
      const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } };
      const active =
        s.activeGroupId && isGroup(doc.nodes[s.activeGroupId]) ? s.activeGroupId : null;
      if (active) {
        transact(withChildIds(doc, active, [...childIdsOf(doc, active), shape.id]));
        set({ selection: [shape.id], ...clearTransient });
        return;
      }
      // Wrap the first stroke in a fresh drawing group and make it active so
      // subsequent strokes collect into it until the user exits the group.
      const groupId = makeId("group");
      const group = { ...groupNode(groupId, [shape.id]), name: "Drawing" };
      const withGroup = { ...doc, nodes: { ...doc.nodes, [groupId]: group } };
      transact(appendToScope(withGroup, currentSymbolScope(s), [groupId]));
      set({ selection: [shape.id], activeGroupId: groupId, ...clearTransient });
    },
    eraseBrushStrokes: (pathWorld, radiusWorld) => {
      if (pathWorld.length === 0 || radiusWorld <= 0) return;
      const state = get();
      const doc = state.doc;
      const eraserBounds = expandBounds(pathBounds(pathWorld), radiusWorld);
      const replacements = new Map<string, string[]>();
      const newNodes: Record<string, SceneNode> = {};
      const removeIds = new Set<string>();
      for (const id of scopeLeafIds(doc, currentSymbolScope(state))) {
        const node = doc.nodes[id];
        if (
          !isShape(node) ||
          node.type !== "brush" ||
          node.stroke === null ||
          node.strokeWidth <= 0 ||
          isNodeHidden(doc, id) ||
          isNodeLocked(doc, id)
        )
          continue;
        if (!intersectBounds(worldShapeBounds(doc, node), eraserBounds)) continue;
        const wm = shapeWorldMatrix(doc, node);
        const pieces = eraseBrush(node, pathWorld, radiusWorld, wm);
        if (pieces === null) continue; // untouched by the eraser
        removeIds.add(node.id);
        const ids = pieces.map((pc) => {
          newNodes[pc.id] = pc;
          return pc.id;
        });
        replacements.set(node.id, ids);
      }
      if (replacements.size === 0) return;
      let next = { ...doc, nodes: { ...doc.nodes, ...newNodes } };
      for (const id of removeIds) delete next.nodes[id];
      // Substitute each erased brush's pieces in place within its parent.
      const parents = new Set<string | null>();
      for (const id of replacements.keys()) parents.add(parentIdOf(doc, id));
      for (const parent of parents) {
        const children = childIdsOf(doc, parent).flatMap((id) =>
          replacements.has(id) ? replacements.get(id)! : [id]
        );
        next = withChildIds(next, parent, children);
      }
      transact(next);
      set({ selection: get().selection.filter((id) => next.nodes[id]), ...clearTransient });
    },
    updateShape: (shape, select = true) => { const doc = get().doc; if (!isShape(doc.nodes[shape.id])) return; const next = { ...doc, nodes: { ...doc.nodes, [shape.id]: shape } }; if (!hasValidClippingMasks(next)) return; transact(next); if (select) set({ selection: [shape.id], ...clearTransient }); },
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
      if (changed) replaceDocumentWithoutHistory({ ...doc, nodes });
    },
    toggleNodeSmooth: (id, sub, index) => {
      const doc = get().doc; const shape = doc.nodes[id]; if (!isShape(shape)) return;
      const next = shape.type === "bezier"
        ? toggleAnchorSmooth(shape, sub, index)
        : shape.type === "brush"
          ? toggleBrushAnchorSmooth(shape, index)
          : null;
      if (!next) return;
      transact({ ...doc, nodes: { ...doc.nodes, [id]: next } });
    },
    deleteEditNode: () => {
      const { doc, editNode } = get(); if (!editNode) return;
      const shape = doc.nodes[editNode.shapeId]; if (!isShape(shape)) return;
      if (shape.type === "brush") {
        const next = deleteBrushAnchor(shape, editNode.index);
        if (next === null) {
          const removed = removeRoots(doc, [shape.id]);
          if (!hasValidClippingMasks(removed)) return;
          transact(removed); set({ selection: [], editNode: null, ...clearTransient });
        } else {
          transact({ ...doc, nodes: { ...doc.nodes, [shape.id]: next } }); set({ editNode: null });
        }
        return;
      }
      if (shape.type !== "bezier") return;
      const sp = shape.subpaths[editNode.sub]; if (!sp) return;
      const anchors = sp.anchors.filter((_, i) => i !== editNode.index);
      // A subpath that can no longer form a segment disappears with its anchor.
      const subpaths = anchors.length < 2
        ? shape.subpaths.filter((_, i) => i !== editNode.sub)
        : shape.subpaths.map((s, i) => (i === editNode.sub ? { ...s, anchors } : s));
      if (subpaths.length === 0) { const next = removeRoots(doc, [shape.id]); if (!hasValidClippingMasks(next)) return; transact(next); set({ selection: [], editNode: null, ...clearTransient }); }
      else { const next = { ...doc, nodes: { ...doc.nodes, [shape.id]: { ...shape, subpaths } } }; if (!hasValidClippingMasks(next)) return; transact(next); set({ editNode: null }); }
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
    placeImportedSvg: (imported, at, fitWithin) => {
      const s = get();
      const root = imported.nodes[imported.rootId];
      if (!root) return;
      const preview = {
        ...s.doc,
        nodes: { ...s.doc.nodes, ...imported.nodes },
        rootIds: [imported.rootId],
      };
      const bounds = unionNodeWorldBounds(preview, [imported.rootId]);
      if (!bounds) return;
      const scale = fitWithin
        ? Math.min(
            1,
            bounds.width > 0 ? fitWithin.width / bounds.width : 1,
            bounds.height > 0 ? fitWithin.height / bounds.height : 1
          )
        : 1;
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      const placement = multiply(
        translation(at.x, at.y),
        multiply(
          [scale, 0, 0, scale, 0, 0],
          translation(-centerX, -centerY)
        )
      );
      const nodes = {
        ...s.doc.nodes,
        ...imported.nodes,
        [root.id]: {
          ...root,
          transform: multiply(placement, root.transform),
        },
      };
      const doc = appendToScope(
        { ...s.doc, nodes },
        currentSymbolScope(s),
        [root.id]
      );
      transact(doc);
      set({ selection: [root.id], ...clearTransient });
    },
    addPatternImage: async (file) => {
      if (!isImageFile(file)) return null;
      const img = await importImageFile(file);
      if (!img) return null;
      const s = get();
      transact({ ...s.doc, assets: { ...s.doc.assets, [img.asset.id]: img.asset } });
      return img.asset.id;
    },
    placeAssetImage: async (assetId, at, fitWithin) => {
      const asset = get().doc.assets[assetId];
      if (!asset) return;
      // Natural size drives the placed box; await a decode so it isn't guessed.
      const img = await loadAssetImage(asset);
      const natW = img && img.naturalWidth > 0 ? img.naturalWidth : 100;
      const natH = img && img.naturalHeight > 0 ? img.naturalHeight : 100;
      const scale = fitWithin
        ? Math.min(1, fitWithin.width / natW, fitWithin.height / natH)
        : 1;
      const width = natW * scale;
      const height = natH * scale;
      const s = get();
      if (!s.doc.assets[assetId]) return; // deleted while decoding
      const shape: ImageShape = {
        id: makeId("image"),
        name: asset.name?.replace(/\.[^.]+$/, "") || "Image",
        type: "image",
        assetId,
        x: at.x - width / 2,
        y: at.y - height / 2,
        width,
        height,
        transform: [1, 0, 0, 1, 0, 0],
        transformOrigin: null,
        opacity: 1,
        fill: null,
        stroke: null,
        strokeWidth: 0,
      };
      const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } };
      transact(appendToScope(doc, currentSymbolScope(s), [shape.id]));
      set({ selection: [shape.id], ...clearTransient });
    },
    deleteAsset: (assetId) => {
      const doc = get().doc;
      if (!doc.assets[assetId] || referencedAssetIds(doc).has(assetId)) return;
      const assets = { ...doc.assets }; delete assets[assetId];
      transact({ ...doc, assets });
    },
    deleteUnusedAssets: () => {
      const doc = get().doc;
      const used = referencedAssetIds(doc);
      const assets = { ...doc.assets };
      let removed = 0;
      for (const id of Object.keys(assets)) if (!used.has(id)) { delete assets[id]; removed++; }
      if (removed) transact({ ...doc, assets });
      return removed;
    },
    // Scripts operate on the scene scope; created shapes join the scene roots.
    applyScriptChanges: ({ created, updated, deleted }) => {
      let doc = get().doc; const del = new Set(deleted);
      for (const id of deleted) if (isShape(doc.nodes[id])) doc = removeRoots(doc, [id]);
      const nodes = { ...doc.nodes };
      for (const shape of updated) if (!del.has(shape.id) && isShape(nodes[shape.id])) nodes[shape.id] = shape;
      for (const shape of created) nodes[shape.id] = shape;
      doc = { ...doc, nodes, rootIds: [...doc.rootIds, ...created.map((s) => s.id)] };
      if (!hasValidClippingMasks(doc)) return;
      transact(doc); set({ selection: [...updated.filter((s) => !del.has(s.id)).map((s) => s.id), ...created.map((s) => s.id)], ...clearTransient });
    },
    updateSelectedStyle: (patch) => {
      const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false;
      const roots = selectionRoots(doc, get().selection);
      for (const root of roots) {
        const ids = isShape(nodes[root]) ? [root] : descendantShapeIds(doc, root);
        for (const id of ids) { nodes[id] = { ...(nodes[id] as Shape), ...patch } as Shape; changed = true; }
      }
      if (changed) transact({ ...doc, nodes }, `style:${roots.join(",")}:${Object.keys(patch).sort().join(",")}`);
    },
    setShapeGeometry: (id, patch) => { const doc = get().doc; const shape = doc.nodes[id]; if (!isShape(shape)) return; const b = shapeBounds(shape); if (shape.type === "text") { const moved = translateShape(shape, (patch.x ?? b.x) - b.x, (patch.y ?? b.y) - b.y); if (moved.type !== "text") return; const next = measureTextShape({ ...moved, width: shape.textMode === "area" ? Math.max(1, patch.width ?? shape.width) : shape.width }); transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, "geom:" + id); return; } let next = resizeShapeToBounds(shape, b, { x: b.x, y: b.y, width: Math.max(1, patch.width ?? b.width), height: Math.max(1, patch.height ?? b.height) }); next = translateShape(next, (patch.x ?? b.x) - b.x, (patch.y ?? b.y) - b.y); transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, "geom:" + id); },
    setRectCornerRadius: (id, radius) => {
      const doc = get().doc; const shape = doc.nodes[id];
      if (!isShape(shape) || shape.type !== "rect" || !Number.isFinite(radius)) return;
      const next = { ...shape, cornerRadius: clampRectCornerRadius(shape, radius) };
      transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, "radius:" + id);
    },
    setImageLockAspect: (id, lock) => { const doc = get().doc; const shape = doc.nodes[id]; if (!isShape(shape) || shape.type !== "image") return; const next = { ...shape, lockAspect: lock || undefined }; transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, "lockAspect:" + id); },
    setClosedSelected: (closed) => { const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false; for (const id of selectionRoots(doc, get().selection)) { const shape = nodes[id]; if (!isShape(shape)) continue; if (shape.type === "path" && shape.closed !== closed) { nodes[id] = { ...shape, closed }; changed = true; } else if (shape.type === "bezier" && shape.subpaths.some((sp) => sp.closed !== closed)) { nodes[id] = { ...shape, subpaths: shape.subpaths.map((sp) => ({ ...sp, closed })) }; changed = true; } } const next = { ...doc, nodes }; if (changed && hasValidClippingMasks(next)) transact(next); },
  };
}
