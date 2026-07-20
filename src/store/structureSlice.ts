// Scene-tree structure: hierarchy, z-order, per-node flags, alignment and
// shape conversions (boolean ops, outline stroke, compound paths).

import { booleanShapes, isAreal } from "../model/boolean";
import { nodeWorldBounds, unionNodeWorldBounds } from "../model/bounds";
import {
  canMakeCompoundPathSelection,
  canCompoundShape,
  canReleaseCompoundPathSelection,
  makeCompoundPath,
  releaseCompoundPath,
} from "../model/compoundPath";
import {
  canMakeClippingMaskSelection,
  canReleaseClippingMaskSelection,
  isClippingGroup,
} from "../model/clippingMask";
import { hasValidSceneContainers } from "../model/sceneValidation";
import {
  IDENTITY,
  applyWorldTransformToNode,
  invertMatrix,
  multiply,
  nodeWorldMatrix,
  translation as translationMatrix,
} from "../model/matrix";
import { strokeOutline } from "../model/outlineStroke";
import { ringsToSubpaths } from "../model/path";
import {
  childIdsOf,
  descendantNodeIds,
  isCompoundPath,
  isContainer,
  isGroup,
  isInstance,
  isShape,
  parentIdOf,
  selectionRoots,
} from "../model/scene";
import { makeId, type Bounds, type Document, type Shape } from "../model/types";
import { groupNode, removeRoots, replaceChildren } from "./docOps";
import {
  clearTransient,
  type StoreCtx,
  type StructureActions,
} from "./state";
import { notify, notifyEffectsRemoved } from "./toastStore";

interface AlignItem { id: string; bounds: Bounds }
function selectionItems(doc: Document, selection: string[]): AlignItem[] {
  return selectionRoots(doc, selection).flatMap((id) => {
    const bounds = nodeWorldBounds(doc, id);
    return bounds ? [{ id, bounds }] : [];
  });
}

/** Expand groups into their parent; group compositing and effects are not preserved. */
function releaseGroups(
  initial: Document,
  ids: string[]
): { doc: Document; selected: string[]; effectsRemoved: boolean } {
  let doc = initial;
  const selected: string[] = [];
  let effectsRemoved = false;
  for (const id of ids) {
    const group = doc.nodes[id];
    if (!isGroup(group)) continue;
    const parent = parentIdOf(doc, id);
    const siblings = childIdsOf(doc, parent);
    const at = siblings.indexOf(id);
    if (at < 0) continue;
    effectsRemoved ||= !!group.effects?.length;
    const children = [...group.childIds];
    const nodes = { ...doc.nodes };
    for (const child of children) {
      const node = nodes[child];
      if (!node) continue;
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
    const order = [...siblings];
    order.splice(at, 1, ...children);
    doc = replaceChildren({ ...doc, nodes }, parent, order);
    selected.push(...children);
  }
  return { doc, selected, effectsRemoved };
}

export function createStructureActions({ set, get, transact }: StoreCtx): StructureActions {
  return {
    deleteSelected: () => {
      const doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (!roots.length) return;
      const next = removeRoots(doc, roots);
      if (!hasValidSceneContainers(next)) return;
      transact(next);
      set({ selection: [], ...clearTransient });
    },
    bringToFront: () => {
      let doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      for (const parent of new Set(roots.map((id) => parentIdOf(doc, id)))) {
        const selected = new Set(
          roots.filter((id) => parentIdOf(doc, id) === parent)
        );
        const ids = childIdsOf(doc, parent);
        doc = replaceChildren(doc, parent, [
          ...ids.filter((id) => !selected.has(id)),
          ...ids.filter((id) => selected.has(id)),
        ]);
      }
      if (!hasValidSceneContainers(doc)) return;
      transact(doc);
    },
    sendToBack: () => {
      let doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      for (const parent of new Set(roots.map((id) => parentIdOf(doc, id)))) {
        const selected = new Set(
          roots.filter((id) => parentIdOf(doc, id) === parent)
        );
        const ids = childIdsOf(doc, parent);
        doc = replaceChildren(doc, parent, [
          ...ids.filter((id) => selected.has(id)),
          ...ids.filter((id) => !selected.has(id)),
        ]);
      }
      if (!hasValidSceneContainers(doc)) return;
      transact(doc);
    },
    groupSelected: () => {
      const { doc } = get(); const roots = selectionRoots(doc, get().selection); if (roots.length < 2) return;
      const parent = parentIdOf(doc, roots[0]); if (!roots.every((id) => parentIdOf(doc, id) === parent)) return;
      const selected = new Set(roots); const siblings = childIdsOf(doc, parent); const members = siblings.filter((id) => selected.has(id)); const insert = siblings.indexOf(members[members.length - 1]); const rest = siblings.filter((id) => !selected.has(id)); const below = siblings.slice(0, insert).filter((id) => !selected.has(id)).length;
      const id = makeId("group"); rest.splice(below, 0, id);
      let next = { ...doc, nodes: { ...doc.nodes, [id]: groupNode(id, members) } }; next = replaceChildren(next, parent, rest); if (!hasValidSceneContainers(next)) return; transact(next); set({ selection: [id], ...clearTransient });
    },
    ungroupSelected: () => {
      const state = get();
      const roots = selectionRoots(state.doc, state.selection);
      const result = releaseGroups(
        state.doc,
        roots
      );
      if (!result.selected.length || !hasValidSceneContainers(result.doc)) return;
      transact(result.doc);
      set({
        selection: result.selected,
        activeGroupId:
          state.activeGroupId && roots.includes(state.activeGroupId)
            ? null
            : state.activeGroupId,
        ...clearTransient,
      });
      if (result.effectsRemoved) notifyEffectsRemoved();
    },
    makeClippingMaskSelected: () => {
      const state = get();
      const { doc, selection } = state;
      if (!canMakeClippingMaskSelection(doc, selection)) return;
      const roots = selectionRoots(doc, selection);
      const parent = parentIdOf(doc, roots[0]);
      const siblings = childIdsOf(doc, parent);
      const selected = new Set(roots);
      const members = siblings.filter((id) => selected.has(id));
      const insert = siblings.indexOf(members[members.length - 1]);
      const rest = siblings.filter((id) => !selected.has(id));
      const below = siblings
        .slice(0, insert)
        .filter((id) => !selected.has(id)).length;
      const id = makeId("group");
      rest.splice(below, 0, id);
      let next: Document = {
        ...doc,
        nodes: {
          ...doc.nodes,
          [id]: {
            ...groupNode(id, members),
            name: "Clip Group",
            clip: true,
          },
        },
      };
      next = replaceChildren(next, parent, rest);
      if (!hasValidSceneContainers(next)) return;
      transact(next);
      set({ selection: [id], ...clearTransient });
    },
    releaseClippingMaskSelected: () => {
      const state = get();
      const { doc, selection } = state;
      if (!canReleaseClippingMaskSelection(doc, selection)) return;
      const roots = selectionRoots(doc, selection).filter((id) =>
        isClippingGroup(doc.nodes[id])
      );
      const result = releaseGroups(doc, roots);
      if (!result.selected.length || !hasValidSceneContainers(result.doc)) return;
      transact(result.doc);
      set({
        selection: result.selected,
        activeGroupId:
          state.activeGroupId && roots.includes(state.activeGroupId)
            ? null
            : state.activeGroupId,
        ...clearTransient,
      });
      if (result.effectsRemoved) notifyEffectsRemoved();
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
    outlineStrokeSelected: () => {
      let doc = get().doc; const selected: string[] = []; let effectsRemoved = false;
      for (const id of selectionRoots(doc, get().selection)) {
        const shape = doc.nodes[id]; if (!isShape(shape) || !shape.stroke || shape.strokeWidth <= 0) continue;
        const polys = strokeOutline(shape, undefined, doc); if (!polys?.length) continue;
        const outline: Shape = { id: makeId("path"), name: "Outline", type: "path", fillRule: "evenodd", subpaths: ringsToSubpaths(polys.flat()), fill: shape.stroke, stroke: null, strokeWidth: 0, opacity: shape.opacity, blendMode: shape.blendMode, transform: [...IDENTITY], transformOrigin: null };
        const parent = parentIdOf(doc, id); const siblings = childIdsOf(doc, parent); const at = siblings.indexOf(id); const nodes = { ...doc.nodes };
        if (isAreal(shape) && shape.fill) { const gid = makeId("group"); nodes[id] = { ...shape, stroke: null }; nodes[outline.id] = outline; nodes[gid] = groupNode(gid, [id, outline.id]); const order = [...siblings]; order.splice(at, 1, gid); doc = replaceChildren({ ...doc, nodes }, parent, order); selected.push(gid); }
        else { effectsRemoved ||= !!shape.effects?.length; for (const removed of [id, ...descendantNodeIds(doc, id)]) delete nodes[removed]; nodes[outline.id] = outline; const order = [...siblings]; order.splice(at, 1, outline.id); doc = replaceChildren({ ...doc, nodes }, parent, order); selected.push(outline.id); }
      }
      if (selected.length && hasValidSceneContainers(doc)) { transact(doc); set({ selection: selected, ...clearTransient }); if (effectsRemoved) notifyEffectsRemoved(); }
    },
    booleanSelected: (op) => {
      const doc = get().doc; const roots = selectionRoots(doc, get().selection); if (roots.length < 2 || !roots.every((id) => isShape(doc.nodes[id]))) return; const parent = parentIdOf(doc, roots[0]); if (!roots.every((id) => parentIdOf(doc, id) === parent)) return; const siblings = childIdsOf(doc, parent); const selected = new Set(roots); const ordered = siblings.filter((id) => selected.has(id)); const effectsRemoved = ordered.some((id) => !!doc.nodes[id]?.effects?.length); const result = booleanShapes(ordered.map((id) => doc.nodes[id] as Shape), op, doc); if (!result) return; const nodes = { ...doc.nodes }; for (const id of roots.flatMap((root) => [root, ...descendantNodeIds(doc, root)])) delete nodes[id]; nodes[result.id] = result; const order = siblings.filter((id) => !selected.has(id)); order.splice(siblings.slice(0, siblings.indexOf(ordered[0])).filter((id) => !selected.has(id)).length, 0, result.id); const next = replaceChildren({ ...doc, nodes }, parent, order); if (!hasValidSceneContainers(next)) return; transact(next); set({ selection: [result.id], ...clearTransient }); if (effectsRemoved) notifyEffectsRemoved();
    },
    makeCompoundPathSelected: () => {
      const doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (!canMakeCompoundPathSelection(doc, roots)) return;
      const parent = parentIdOf(doc, roots[0]);
      const siblings = childIdsOf(doc, parent);
      const selected = new Set(roots);
      const ordered = siblings.filter((id) => selected.has(id));
      const effectsRemoved = ordered.some((id) => !!doc.nodes[id]?.effects?.length);
      const compound = makeCompoundPath(ordered.map((id) => doc.nodes[id] as Shape));
      if (!compound) return;
      const nodes = { ...doc.nodes };
      for (const id of ordered) {
        const node = nodes[id];
        if (!isCompoundPath(node)) continue;
        for (const childId of node.childIds) {
          const child = nodes[childId];
          if (child) {
            nodes[childId] = {
              ...child,
              transform: multiply(node.transform, child.transform),
            };
          }
        }
        delete nodes[id];
      }
      nodes[compound.id] = compound;
      const order = siblings.filter((id) => !selected.has(id));
      const at = siblings.slice(0, siblings.indexOf(ordered[0])).filter((id) => !selected.has(id)).length;
      order.splice(at, 0, compound.id);
      const next = replaceChildren({ ...doc, nodes }, parent, order);
      if (!hasValidSceneContainers(next)) return;
      transact(next);
      set({ selection: [compound.id], ...clearTransient });
      if (effectsRemoved) notifyEffectsRemoved();
    },
    releaseCompoundPathSelected: () => {
      let doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (!canReleaseCompoundPathSelection(doc, roots)) return;
      const selected: string[] = [];
      let effectsRemoved = false;
      for (const id of roots) {
        const compound = doc.nodes[id];
        if (!compound || compound.type !== "compoundPath") continue;
        effectsRemoved ||= !!compound.effects?.length;
        const parent = parentIdOf(doc, id);
        const siblings = childIdsOf(doc, parent);
        const at = siblings.indexOf(id);
        const released = releaseCompoundPath(doc, compound);
        const nodes = { ...doc.nodes };
        delete nodes[id];
        for (const shape of released) nodes[shape.id] = shape;
        const order = [...siblings];
        order.splice(at, 1, ...released.map((shape) => shape.id));
        doc = replaceChildren({ ...doc, nodes }, parent, order);
        selected.push(...released.map((shape) => shape.id));
      }
      if (selected.length && hasValidSceneContainers(doc)) {
        transact(doc);
        set({ selection: selected, ...clearTransient });
        if (effectsRemoved) notifyEffectsRemoved();
      }
    },
    toggleHidden: (id) => { const doc = get().doc, node = doc.nodes[id]; if (!node) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, hidden: !node.hidden } } }); if (!node.hidden) { const affected = new Set([id, ...descendantNodeIds(doc, id)]); set({ selection: get().selection.filter((x) => !affected.has(x)), ...clearTransient }); } },
    toggleLocked: (id) => { const doc = get().doc, node = doc.nodes[id]; if (!node) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, locked: !node.locked } } }); if (!node.locked) { const affected = new Set([id, ...descendantNodeIds(doc, id)]); set({ selection: get().selection.filter((x) => !affected.has(x)), ...clearTransient }); } },
    renameNode: (id, name) => { const doc = get().doc, node = doc.nodes[id]; if (!node) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, name } } }); },
    updateNodeStyle: (id, patch) => { const doc = get().doc, node = doc.nodes[id]; if (!isGroup(node) && !isInstance(node)) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, ...patch } } }, "nstyle:" + id + ":" + Object.keys(patch).sort().join(",")); if (patch.hidden || patch.locked) { const affected = new Set([id, ...descendantNodeIds(doc, id)]); set({ selection: get().selection.filter((x) => !affected.has(x)), ...clearTransient }); } },
    setNodeEffects: (id, effects) => {
      const doc = get().doc;
      const node = doc.nodes[id];
      if (!node) return;
      transact(
        { ...doc, nodes: { ...doc.nodes, [id]: { ...node, effects: effects.length ? effects : undefined } } },
        "effects:" + id
      );
    },
    moveNode: (id, parent, index) => {
      const doc = get().doc;
      const node = doc.nodes[id];
      const target = parent === null ? undefined : doc.nodes[parent];
      if (!node) return;
      if (parent !== null && !isContainer(target)) {
        notify.error("That layer cannot contain child layers.");
        return;
      }
      if (isCompoundPath(target) && (!isShape(node) || !canCompoundShape(node) ||
          node.type === "compoundPath")) {
        notify.error(
          "Compound paths only accept rectangles, ellipses, and closed paths."
        );
        return;
      }
      if (parent === id || descendantNodeIds(doc, id).includes(parent ?? "")) {
        notify.error("A layer cannot be moved into itself or its descendants.");
        return;
      }

      const oldParent = parentIdOf(doc, id);
      const oldContainer = oldParent === null ? undefined : doc.nodes[oldParent];
      if (oldParent !== parent && isCompoundPath(oldContainer) &&
          oldContainer.childIds.length <= 1) {
        notify.error("A compound path must contain at least one child.");
        return;
      }
      const oldWorld = nodeWorldMatrix(doc, id);
      const targetWorld = nodeWorldMatrix(doc, parent);
      const inverseTarget = invertMatrix(targetWorld);
      if (!inverseTarget) {
        notify.error("The target layer has a non-invertible transform.");
        return;
      }

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

      if (!hasValidSceneContainers(next)) {
        notify.error("That move would create an invalid scene container.");
        return;
      }
      transact(next);
    },
  };
}
