// Creating and mutating individual shapes (geometry, style, text).
// Anchor-level path editing lives in pathEditSlice, generator nodes in
// generatorSlice, and image assets in assetSlice.

import { expandBounds, instanceWorldBounds, intersectBounds, shapeBounds, worldShapeBounds } from "@/model/geometry/bounds";
import { acceptsScene } from "./sceneGuard";
import { eraseBrush } from "@/model/brush/eraser";
import { applyMatrix, applyWorldTransformToNode, boundsTransform, IDENTITY, invertMatrix, isIdentity, multiply, nodeWorldMatrix, shapeWorldMatrix, translation as translationMatrix } from "@/model/geometry/matrix";
import { isMarkable } from "@/model/marker";
import { moveAnchors } from "@/model/nodeEdit";
import { childIdsOf, descendantShapeIds, isGroup, isInstance, isNodeHidden, isNodeLocked, isShape, parentIdOf, scopeLeafIds, selectionRoots, withChildIds } from "../model/scene";
import { clampRectCornerRadius } from "../model/roundedRect";
import { resizeShapeToBounds, translateShape } from "@/model/geometry/transforms";
import { makeId, type Bounds, type SceneNode, type Shape, type Vec2 } from "../model/types";
import { measureTextShape, remeasureDocumentText } from "../canvas/textLayout";
import { appendToScope, groupNode } from "./docOps";
import {
  clearTransient,
  currentFocusRoot,
  groupEditNodesByShape,
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
    addShape: (shape, select = true) => {
      const s = get();
      const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } };
      const next = appendToScope(doc, currentFocusRoot(s), [shape.id]);
      if (!next) return;
      transact(next, { label: "Add shape" });
      if (select) set({ selection: [shape.id], ...clearTransient });
    },
    addShapes: (shapes, select = true) => {
      if (!shapes.length) return;
      const s = get();
      const doc = {
        ...s.doc,
        nodes: {
          ...s.doc.nodes,
          ...Object.fromEntries(shapes.map((shape) => [shape.id, shape])),
        },
      };
      const next = appendToScope(
        doc,
        currentFocusRoot(s),
        shapes.map((shape) => shape.id)
      );
      if (!next) return;
      transact(next, { label: `Add ${shapes.length} shapes` });
      if (select) set({ selection: shapes.map((shape) => shape.id), ...clearTransient });
    },
    addBrushStroke: (shape) => {
      const s = get();
      const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } };
      const active =
        s.activeGroupId && isGroup(doc.nodes[s.activeGroupId]) ? s.activeGroupId : null;
      if (active) {
        // The stroke is world-space geometry, so parenting it under a group
        // that has been moved needs that group's inverse world matrix baked in
        // (same conversion as addFillShape and appendToScope).
        const inverse = invertMatrix(nodeWorldMatrix(doc, active));
        if (!inverse) return;
        const placed = !isIdentity(inverse)
          ? { ...shape, transform: multiply(inverse, shape.transform) }
          : shape;
        const withPlaced = { ...doc, nodes: { ...doc.nodes, [placed.id]: placed } };
        transact(withChildIds(withPlaced, active, [...childIdsOf(withPlaced, active), placed.id]), { label: "Draw brush stroke" });
        set({ selection: [shape.id], ...clearTransient });
        return;
      }
      // Wrap the first stroke in a fresh drawing group and make it active so
      // subsequent strokes collect into it until the user exits the group.
      const groupId = makeId("group");
      const group = { ...groupNode(groupId, [shape.id]), name: "Drawing" };
      const withGroup = { ...doc, nodes: { ...doc.nodes, [groupId]: group } };
      const next = appendToScope(withGroup, currentFocusRoot(s), [groupId]);
      if (!next) return;
      transact(next, { label: "Draw brush stroke" });
      set({ selection: [shape.id], activeGroupId: groupId, ...clearTransient });
    },
    addFillShape: (shape, aboveId) => {
      const s = get();
      const above = aboveId ? s.doc.nodes[aboveId] : undefined;
      let parentId: string | null;
      let index: number;
      if (above) {
        // Right above the cover the fill was clicked on: over its color but
        // still under the line art painted later.
        parentId = parentIdOf(s.doc, above.id);
        index = childIdsOf(s.doc, parentId).indexOf(above.id) + 1;
      } else {
        const active =
          s.activeGroupId && isGroup(s.doc.nodes[s.activeGroupId]) ? s.activeGroupId : null;
        parentId = active ?? currentFocusRoot(s);
        index = 0;
      }
      // The fill's geometry is in scope-view space; parenting it under the
      // container needs the inverse of the container's world matrix baked into
      // its transform so it lands exactly where it was computed.
      const world = parentId ? nodeWorldMatrix(s.doc, parentId) : IDENTITY;
      const inverse = invertMatrix(world);
      if (!inverse) return;
      const placed = {
        ...shape,
        transform: multiply(inverse, shape.transform),
      };
      const doc = { ...s.doc, nodes: { ...s.doc.nodes, [placed.id]: placed } };
      const siblings = childIdsOf(doc, parentId);
      transact(
        withChildIds(doc, parentId, [
          ...siblings.slice(0, index),
          placed.id,
          ...siblings.slice(index),
        ]),
        { label: "Fill area" }
      );
      set({ selection: [placed.id], ...clearTransient });
    },
    eraseBrushStrokes: (pathWorld, radiusWorld) => {
      if (pathWorld.length === 0 || radiusWorld <= 0) return;
      const state = get();
      const doc = state.doc;
      const eraserBounds = expandBounds(pathBounds(pathWorld), radiusWorld);
      const replacements = new Map<string, string[]>();
      const newNodes: Record<string, SceneNode> = {};
      const removeIds = new Set<string>();
      for (const id of scopeLeafIds(doc, currentFocusRoot(state))) {
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
      transact(next, { label: "Erase brush strokes" });
      set({ selection: get().selection.filter((id) => next.nodes[id]), ...clearTransient });
    },
    updateShape: (shape, select = true) => { const doc = get().doc; if (!isShape(doc.nodes[shape.id])) return; const next = { ...doc, nodes: { ...doc.nodes, [shape.id]: shape } }; if (!acceptsScene(next)) return; transact(next, { label: "Edit shape" }); if (select) set({ selection: [shape.id], ...clearTransient }); },
    updateTextShape: (id, patch) => {
      const doc = get().doc; const shape = doc.nodes[id];
      if (!isShape(shape) || shape.type !== "text") return;
      const next = measureTextShape({ ...shape, ...patch });
      transact(
        { ...doc, nodes: { ...doc.nodes, [id]: next } },
        {
          label: "Edit text",
          coalesceKey: `text:${id}:${Object.keys(patch).sort().join(",")}`,
        }
      );
    },
    remeasureTextShapes: () => {
      const doc = get().doc;
      const next = remeasureDocumentText(doc);
      if (next !== doc) replaceDocumentWithoutHistory(next);
    },
    updateSelectedStyle: (patch) => {
      const doc = get().doc; const nodes = { ...doc.nodes }; let changed = false;
      const roots = selectionRoots(doc, get().selection);
      for (const root of roots) {
        const ids = isShape(nodes[root]) ? [root] : descendantShapeIds(doc, root);
        for (const id of ids) { nodes[id] = { ...(nodes[id] as Shape), ...patch } as Shape; changed = true; }
      }
      if (changed) transact({ ...doc, nodes }, { label: "Edit style", coalesceKey: `style:${roots.join(",")}:${Object.keys(patch).sort().join(",")}` });
    },
    setSelectedMarkers: (patch) => {
      const doc = get().doc;
      const nodes = { ...doc.nodes };
      let changed = false;
      const roots = selectionRoots(doc, get().selection);
      for (const root of roots) {
        const ids = isShape(nodes[root]) ? [root] : descendantShapeIds(doc, root);
        for (const id of ids) {
          const shape = nodes[id];
          if (!isMarkable(shape)) continue;
          // Absent, not null, is "no marker" — so clearing deletes the field.
          const next = { ...shape };
          if (patch.start !== undefined) {
            if (patch.start) next.markerStart = patch.start;
            else delete next.markerStart;
          }
          if (patch.end !== undefined) {
            if (patch.end) next.markerEnd = patch.end;
            else delete next.markerEnd;
          }
          nodes[id] = next;
          changed = true;
        }
      }
      if (!changed) return;
      transact(
        { ...doc, nodes },
        {
          label: "Edit markers",
          coalesceKey: `markers:${roots.join(",")}:${Object.keys(patch).sort().join(",")}`,
        }
      );
    },
    setShapeGeometry: (id, patch) => {
      const doc = get().doc;
      const shape = doc.nodes[id];
      const options = { label: "Edit geometry", coalesceKey: "geom:" + id };
      if (isInstance(shape)) {
        const wf = instanceWorldBounds(doc, shape);
        if (!wf) return;
        const to = {
          x: patch.x ?? wf.x,
          y: patch.y ?? wf.y,
          width: Math.max(1, patch.width ?? wf.width),
          height: Math.max(1, patch.height ?? wf.height),
        };
        const next = applyWorldTransformToNode(doc, shape, boundsTransform(wf, to));
        transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, options);
        return;
      }
      if (!isShape(shape)) return;
      if (shape.generator || shape.type === "compoundPath") {
        const wf = worldShapeBounds(doc, shape);
        const to = {
          x: patch.x ?? wf.x,
          y: patch.y ?? wf.y,
          width: Math.max(1, patch.width ?? wf.width),
          height: Math.max(1, patch.height ?? wf.height),
        };
        const next = applyWorldTransformToNode(doc, shape, boundsTransform(wf, to));
        transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, options);
        return;
      }
      const b = shapeBounds(shape, doc);
      if (shape.type === "text") {
        const moved = translateShape(
          shape,
          (patch.x ?? b.x) - b.x,
          (patch.y ?? b.y) - b.y
        );
        if (moved.type !== "text") return;
        const next = measureTextShape({
          ...moved,
          width:
            shape.textMode === "area"
              ? Math.max(1, patch.width ?? shape.width)
              : shape.width,
        });
        transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, options);
        return;
      }
      let next = resizeShapeToBounds(shape, b, {
        x: b.x,
        y: b.y,
        width: Math.max(1, patch.width ?? b.width),
        height: Math.max(1, patch.height ?? b.height),
      });
      next = translateShape(
        next,
        (patch.x ?? b.x) - b.x,
        (patch.y ?? b.y) - b.y
      );
      transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, options);
    },
    nudge: (dx, dy) => {
      const { doc, editNodes, selection } = get();
      const nodes = { ...doc.nodes };
      let changed = false;
      if (editNodes.length > 0) {
        for (const [shapeId, targets] of groupEditNodesByShape(editNodes)) {
          const shape = doc.nodes[shapeId];
          if (!isShape(shape) || (shape.type !== "path" && shape.type !== "brush")) continue;
          // Anchors live in the shape's own space, so the world delta has to be
          // mapped through the inverse world matrix (rotation included).
          const inverse = invertMatrix(shapeWorldMatrix(doc, shape));
          const origin = inverse ? applyMatrix(inverse, { x: 0, y: 0 }) : { x: 0, y: 0 };
          const moved = inverse ? applyMatrix(inverse, { x: dx, y: dy }) : { x: dx, y: dy };
          // `withSubpath` inside moveAnchors drops any generator link, as it
          // does for a pointer drag: edited vertices override parametric
          // geometry.
          const next = moveAnchors(shape, targets, moved.x - origin.x, moved.y - origin.y);
          if (next === shape) continue;
          nodes[shapeId] = next;
          changed = true;
        }
      } else {
        const delta = translationMatrix(dx, dy);
        for (const id of selectionRoots(doc, selection)) {
          const node = doc.nodes[id];
          if (!node) continue;
          nodes[id] = applyWorldTransformToNode(doc, node, delta);
          changed = true;
        }
      }
      if (!changed) return;
      // One undo step per run of presses; retargeting what is moved starts a
      // new step (the key names the moved things).
      transact({ ...doc, nodes }, {
        label: "Nudge",
        coalesceKey: `nudge:${editNodes.length ? "nodes" : "shapes"}:${
          editNodes.length
            ? editNodes.map((n) => `${n.shapeId}:${n.sub}:${n.index}`).join(",")
            : selection.join(",")
        }`,
      });
    },
    setRectCornerRadius: (id, radius) => {
      const doc = get().doc; const shape = doc.nodes[id];
      if (!isShape(shape) || shape.type !== "rect" || !Number.isFinite(radius)) return;
      const next = { ...shape, cornerRadius: clampRectCornerRadius(shape, radius) };
      transact(
        { ...doc, nodes: { ...doc.nodes, [id]: next } },
        { label: "Edit corner radius", coalesceKey: "radius:" + id }
      );
    },
    setImageLockAspect: (id, lock) => { const doc = get().doc; const shape = doc.nodes[id]; if (!isShape(shape) || shape.type !== "image") return; const next = { ...shape, lockAspect: lock }; transact({ ...doc, nodes: { ...doc.nodes, [id]: next } }, { label: lock ? "Lock aspect ratio" : "Unlock aspect ratio", coalesceKey: "lockAspect:" + id }); },
  };
}
