// Scene-tree structure: hierarchy, z-order, per-node flags and alignment.
// The conversions that replace selected shapes (boolean ops, outline stroke,
// compound paths) live in shapeOpsSlice.

import { nodeWorldBounds, unionNodeWorldBounds } from "@/model/geometry/bounds";
import { selectionFrameForSelection } from "@/model/geometry/selectionFrame";
import { canCompoundShape } from "@/model/path/compoundPath";
import {
  canMakeClippingMaskSelection,
  canReleaseClippingMaskSelection,
  isClippingGroup,
} from "../model/clippingMask";
import { acceptsScene } from "./sceneGuard";
import {
  applyMatrix,
  applyWorldTransformToNode,
  invertMatrix,
  multiply,
  nodeWorldMatrix,
  translation as translationMatrix,
} from "@/model/geometry/matrix";
import {
  childIdsOf,
  descendantNodeIds,
  isCompoundPath,
  isContainer,
  isFrame,
  isGroup,
  isInstance,
  isShape,
  parentIdOf,
  selectionRoots,
} from "../model/scene";
import { makeId, type Bounds, type Document, type Matrix } from "../model/types";
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
    effectsRemoved ||= group.effects.length > 0;
    const children = [...group.childIds];
    const nodes = { ...doc.nodes };
    for (const child of children) {
      const node = nodes[child];
      if (!node) continue;
      nodes[child] = {
        ...node,
        transform: multiply(group.transform, node.transform),
        opacity: node.opacity * group.opacity,
        // "normal" is the neutral value, so an unstyled child takes the
        // dissolving group's blend rather than overriding it with normal.
        blendMode: node.blendMode === "normal" ? group.blendMode : node.blendMode,
        hidden: node.hidden || group.hidden,
        locked: node.locked || group.locked,
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

/**
 * Drop a node and its descendants from the selection, leaving the selection
 * untouched — same array, no transient reset — when none of them were selected.
 */
function deselectSubtree(
  get: StoreCtx["get"],
  set: StoreCtx["set"],
  doc: Document,
  id: string
): void {
  const affected = new Set([id, ...descendantNodeIds(doc, id)]);
  const selection = get().selection;
  if (!selection.some((x) => affected.has(x))) return;
  set({ selection: selection.filter((x) => !affected.has(x)), ...clearTransient });
}

export function createStructureActions({ set, get, transact }: StoreCtx): StructureActions {
  const reorderStep = (forward: boolean) => {
    let doc = get().doc;
    const roots = selectionRoots(doc, get().selection);
    if (!roots.length) return;
    for (const parent of new Set(roots.map((id) => parentIdOf(doc, id)))) {
      const selected = new Set(roots.filter((id) => parentIdOf(doc, id) === parent));
      const ids = childIdsOf(doc, parent).slice();
      if (forward) {
        // Walk selected items toward the end (front); from the top so a block moves together.
        for (let i = ids.length - 2; i >= 0; i--) {
          if (selected.has(ids[i]) && !selected.has(ids[i + 1])) {
            [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]];
          }
        }
      } else {
        for (let i = 1; i < ids.length; i++) {
          if (selected.has(ids[i]) && !selected.has(ids[i - 1])) {
            [ids[i], ids[i - 1]] = [ids[i - 1], ids[i]];
          }
        }
      }
      doc = replaceChildren(doc, parent, ids);
    }
    if (!acceptsScene(doc)) return;
    transact(doc, {
      label: forward ? "Bring forward" : "Send backward",
      coalesceKey: "layer-reorder",
    });
  };
  const flipSelected = (axis: "horizontal" | "vertical") => {
    const state = get();
    const { doc } = state;
    const roots = selectionRoots(doc, state.selection);
    // A frame is a layout viewport rather than artwork. Its
    // box and label assume an ordinary top-left origin, so flipping it would
    // make the editor chrome disagree with the document transform.
    if (!roots.length || roots.some((id) => isFrame(doc.nodes[id]))) return;
    const frame = selectionFrameForSelection(
      doc,
      state.selection,
      state.selectionPivot,
      state.selectionTransform
    );
    if (!frame) return;
    const inverseFrame = invertMatrix(frame.transform);
    if (!inverseFrame) {
      notify.error("The selection has a non-invertible transform.");
      return;
    }
    // All roots must accept the same world delta. Refuse the whole operation
    // when any parent space is singular instead of partially flipping a
    // selection and violating the document transform invariant.
    if (
      roots.some(
        (id) => !invertMatrix(nodeWorldMatrix(doc, parentIdOf(doc, id)))
      )
    ) {
      notify.error("The selection has a non-invertible parent transform.");
      return;
    }
    const centerX = frame.bounds.x + frame.bounds.width / 2;
    const centerY = frame.bounds.y + frame.bounds.height / 2;
    const localFlip: Matrix = axis === "horizontal"
      ? [-1, 0, 0, 1, centerX * 2, 0]
      : [1, 0, 0, -1, 0, centerY * 2];
    const delta = multiply(
      frame.transform,
      multiply(localFlip, inverseFrame)
    );
    const nodes = { ...doc.nodes };
    for (const id of roots) {
      nodes[id] = applyWorldTransformToNode(doc, nodes[id], delta);
    }
    const label = axis === "horizontal"
      ? "Flip horizontally"
      : "Flip vertically";
    transact({ ...doc, nodes }, { label });
    set({
      selectionPivot: state.selectionPivot
        ? applyMatrix(delta, state.selectionPivot)
        : null,
      selectionTransform: state.selectionTransform
        ? multiply(delta, state.selectionTransform)
        : null,
    });
  };
  return {
    deleteSelected: () => {
      const doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (!roots.length) return;
      const next = removeRoots(doc, roots);
      if (!acceptsScene(next)) return;
      transact(next, {
        label: roots.length === 1 ? "Delete shape" : `Delete ${roots.length} shapes`,
      });
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
      if (!acceptsScene(doc)) return;
      transact(doc, { label: "Bring to front" });
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
      if (!acceptsScene(doc)) return;
      transact(doc, { label: "Send to back" });
    },
    // One-slot reorder, per parent. `childIds` is canonical back-to-front, so
    // "forward" (toward the front) walks a selected item toward the end of the
    // array; iterating from that end lets a contiguous block move as one. A key
    // repeat coalesces into a single undo step.
    raiseSelected: () => reorderStep(true),
    lowerSelected: () => reorderStep(false),
    groupSelected: () => {
      const { doc } = get(); const roots = selectionRoots(doc, get().selection); if (roots.length < 2) return;
      // Frames must stay top-level, so they can never be pulled into a group.
      if (roots.some((id) => isFrame(doc.nodes[id]))) return;
      const parent = parentIdOf(doc, roots[0]); if (!roots.every((id) => parentIdOf(doc, id) === parent)) return;
      const selected = new Set(roots); const siblings = childIdsOf(doc, parent); const members = siblings.filter((id) => selected.has(id)); const insert = siblings.indexOf(members[members.length - 1]); const rest = siblings.filter((id) => !selected.has(id)); const below = siblings.slice(0, insert).filter((id) => !selected.has(id)).length;
      const id = makeId("group"); rest.splice(below, 0, id);
      let next = { ...doc, nodes: { ...doc.nodes, [id]: groupNode(id, members) } }; next = replaceChildren(next, parent, rest); if (!acceptsScene(next)) return; transact(next, { label: "Group selection" }); set({ selection: [id], ...clearTransient });
    },
    ungroupSelected: () => {
      const state = get();
      const roots = selectionRoots(state.doc, state.selection);
      const result = releaseGroups(
        state.doc,
        roots
      );
      if (!result.selected.length || !acceptsScene(result.doc)) return;
      transact(result.doc, { label: "Ungroup selection" });
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
            clipsToMask: true,
          },
        },
      };
      next = replaceChildren(next, parent, rest);
      if (!acceptsScene(next)) return;
      transact(next, { label: "Make clipping mask" });
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
      if (!result.selected.length || !acceptsScene(result.doc)) return;
      transact(result.doc, { label: "Release clipping mask" });
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
    flipSelectedHorizontally: () => flipSelected("horizontal"),
    flipSelectedVertically: () => flipSelected("vertical"),
    alignSelected: (type) => {
      const doc = get().doc; const items = selectionItems(doc, get().selection); const union = unionNodeWorldBounds(doc, items.map((i) => i.id)); if (items.length < 2 || !union) return; const nodes = { ...doc.nodes };
      for (const item of items) { const b = item.bounds; let dx = 0, dy = 0; if (type === "left") dx = union.x - b.x; if (type === "hcenter") dx = union.x + union.width / 2 - b.x - b.width / 2; if (type === "right") dx = union.x + union.width - b.x - b.width; if (type === "top") dy = union.y - b.y; if (type === "vmiddle") dy = union.y + union.height / 2 - b.y - b.height / 2; if (type === "bottom") dy = union.y + union.height - b.y - b.height; if (dx || dy) nodes[item.id] = applyWorldTransformToNode(doc, nodes[item.id], translationMatrix(dx, dy)); }
      transact(
        { ...doc, nodes },
        { label: `Align ${type === "hcenter" ? "horizontal centers" : type === "vmiddle" ? "vertical centers" : type}` }
      ); set(clearTransient);
    },
    distributeSelected: (axis) => {
      const doc = get().doc; const items = selectionItems(doc, get().selection); if (items.length < 3) return; const horizontal = axis === "h"; const start = (b: Bounds) => horizontal ? b.x : b.y; const size = (b: Bounds) => horizontal ? b.width : b.height; const sorted = [...items].sort((a, b) => start(a.bounds) - start(b.bounds)); const last = sorted[sorted.length - 1]; const span = start(last.bounds) + size(last.bounds) - start(sorted[0].bounds); const gap = (span - sorted.reduce((n, x) => n + size(x.bounds), 0)) / (sorted.length - 1); const nodes = { ...doc.nodes }; let cursor = start(sorted[0].bounds) + size(sorted[0].bounds) + gap;
      for (const item of sorted.slice(1, -1)) { const d = cursor - start(item.bounds); nodes[item.id] = applyWorldTransformToNode(doc, nodes[item.id], translationMatrix(horizontal ? d : 0, horizontal ? 0 : d)); cursor += size(item.bounds) + gap; }
      transact(
        { ...doc, nodes },
        { label: `Distribute ${axis === "h" ? "horizontally" : "vertically"}` }
      ); set(clearTransient);
    },
    // Hiding or locking a node drops it (and its subtree) from the selection —
    // but only when something is actually dropped. Setting an equal-but-new
    // selection array would still count as a selection change downstream, and
    // subscribers act on that: the Layers panel scrolls the last selected row
    // into view, so an untouched selection must keep its identity.
    toggleHidden: (id) => { const doc = get().doc, node = doc.nodes[id]; if (!node) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, hidden: !node.hidden } } }, { label: node.hidden ? "Show layer" : "Hide layer" }); if (!node.hidden) deselectSubtree(get, set, doc, id); },
    toggleLocked: (id) => { const doc = get().doc, node = doc.nodes[id]; if (!node) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, locked: !node.locked } } }, { label: node.locked ? "Unlock layer" : "Lock layer" }); if (!node.locked) deselectSubtree(get, set, doc, id); },
    // Coalesced: the properties header renames on every keystroke, and one undo
    // step per character is unusable. A typing pause ends the step.
    renameNode: (id, name) => { const doc = get().doc, node = doc.nodes[id]; if (!node) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, name } } }, { label: "Rename layer", coalesceKey: "rename:" + id }); },
    updateNodeStyle: (id, patch) => { const doc = get().doc, node = doc.nodes[id]; if (!isGroup(node) && !isInstance(node)) return; transact({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, ...patch } } }, { label: "Edit layer style", coalesceKey: "nstyle:" + id + ":" + Object.keys(patch).sort().join(",") }); },
    setNodeEffects: (id, effects) => {
      const doc = get().doc;
      const node = doc.nodes[id];
      if (!node) return;
      transact(
        { ...doc, nodes: { ...doc.nodes, [id]: { ...node, effects } } },
        { label: "Edit effects", coalesceKey: "effects:" + id }
      );
    },
    moveNode: (id, parent, index) => get().moveNodes([id], parent, index),

    moveNodes: (ids, parent, index) => {
      const doc = get().doc;
      const moving = ids.filter((id) => !!doc.nodes[id]);
      if (moving.length === 0) return;
      const target = parent === null ? undefined : doc.nodes[parent];
      if (parent !== null && !isContainer(target)) {
        notify.error("That layer cannot contain child layers.");
        return;
      }
      const targetWorld = nodeWorldMatrix(doc, parent);
      const inverseTarget = invertMatrix(targetWorld);
      if (!inverseTarget) {
        notify.error("The target layer has a non-invertible transform.");
        return;
      }
      for (const id of moving) {
        const node = doc.nodes[id];
        // Frames are a top-level invariant: never reparent one under a container.
        if (isFrame(node) && parent !== null) {
          notify.error("Frames must stay at the top level.");
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
      }

      // World matrices have to be read before anything leaves its container.
      const oldWorld = new Map(moving.map((id) => [id, nodeWorldMatrix(doc, id)]));
      const oldParents = new Set(moving.map((id) => parentIdOf(doc, id)));
      let next = doc;
      for (const oldParent of oldParents) {
        const kept = childIdsOf(doc, oldParent).filter((c) => !moving.includes(c));
        const container = oldParent === null ? undefined : doc.nodes[oldParent];
        if (oldParent !== parent && isCompoundPath(container) && kept.length === 0) {
          notify.error("A compound path must contain at least one child.");
          return;
        }
        next = replaceChildren(next, oldParent, kept);
      }

      const targetChildren = childIdsOf(next, parent).filter((c) => !moving.includes(c));
      const at = Math.max(0, Math.min(Math.trunc(index), targetChildren.length));
      targetChildren.splice(at, 0, ...moving);
      if (
        oldParents.size === 1 &&
        oldParents.has(parent) &&
        targetChildren.every((child, i) => childIdsOf(doc, parent)[i] === child)
      ) return;
      next = replaceChildren(next, parent, targetChildren);
      next = {
        ...next,
        nodes: {
          ...next.nodes,
          ...Object.fromEntries(
            moving.map((id) => [
              id,
              { ...next.nodes[id], transform: multiply(inverseTarget, oldWorld.get(id)!) },
            ])
          ),
        },
      };

      // The catch-all behind the specific refusals above: the message stays
      // deliberately vague, so the guard still logs which invariant broke.
      if (!acceptsScene(next, "Move layer", { toast: false })) {
        notify.error("That move would create an invalid scene container.");
        return;
      }
      transact(next, { label: moving.length > 1 ? "Move layers" : "Move layer" });
    },
  };
}
