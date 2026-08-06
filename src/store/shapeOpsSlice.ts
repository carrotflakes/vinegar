// Selection-wide shape conversions: to editable paths, stroke outlines,
// boolean/divide, join/combine/split, and compound paths. Every one of these
// replaces the selected nodes with the shape(s) the operation produces.

import { booleanShapes, divideShapes, DIVIDE_MAX_INPUTS, isAreal } from "@/model/path/boolean";
import {
  canCombineSelection,
  combineInputs,
  combineShapes,
} from "@/model/path/combinePaths";
import { joinShapes } from "@/model/path/joinPath";
import {
  canMakeCompoundPathSelection,
  canReleaseCompoundPathSelection,
  makeCompoundPath,
  releaseCompoundPath,
} from "@/model/path/compoundPath";
import { isClippingMaskNode } from "../model/clippingMask";
import {
  canConvertShapeToPath,
  convertShapeToPath,
} from "@/model/path/convertToPath";
import {
  canConvertBrushToOutline,
  canConvertPathToBrush,
  convertBrushToOutlinePath,
  convertPathToBrush,
} from "@/model/brush/convertBrush";
import { hasValidSceneContainers } from "../model/sceneValidation";
import { IDENTITY, multiply } from "@/model/geometry/matrix";
import { strokeOutline } from "@/model/path/outlineStroke";
import { ringsToSubpaths } from "@/model/path/path";
import {
  canSplitSubpaths,
  flattenSplitPieces,
  splitSubpaths,
} from "@/model/path/splitSubpaths";
import {
  childIdsOf,
  descendantNodeIds,
  isCompoundPath,
  isGroup,
  isShape,
  parentIdOf,
  selectionRoots,
} from "../model/scene";
import {
  baseNodeDefaults,
  baseShapeDefaults,
  makeId,
  type Document,
  type PathShape,
  type Shape,
} from "../model/types";
import { groupNode, replaceChildren } from "./docOps";
import {
  clearTransient,
  type ShapeOpsActions,
  type StoreCtx,
} from "./state";
import { notify, notifyEffectsRemoved } from "./toastStore";

/**
 * A clipping mask is its group's frontmost child, so an op that turns one node
 * into several would either leave the clip invalid (a group is not a valid
 * mask) or silently demote all but the frontmost piece to clipped content.
 * Such ops refuse and say so rather than rewriting the clip.
 */
const maskMultiNodeError = (verb: string) =>
  `A clipping mask cannot be ${verb}. Release the clipping mask first.`;

/**
 * The message for a combine whose members carry a hidden or locked flag the
 * single result node cannot represent, or null when none do. Refusing keeps a
 * hidden member from reappearing in the result and a locked one from being
 * consumed by an edit its lock is meant to prevent.
 */
function combineBlockedFlags(doc: Document, consumed: string[]): string | null {
  const hidden = consumed.some((id) => doc.nodes[id]?.hidden);
  const locked = consumed.some((id) => doc.nodes[id]?.locked);
  if (hidden && locked) {
    return "Hidden and locked members cannot be combined. Unhide and unlock them first.";
  }
  if (hidden) {
    return "A hidden member cannot be combined — it would come back visible. Unhide it first.";
  }
  if (locked) return "A locked member cannot be combined. Unlock it first.";
  return null;
}

/**
 * The child list after several consumed siblings collapse into one result node,
 * which takes the frontmost consumed slot so the result keeps the paint order
 * the inputs had.
 */
function collapseSiblings(
  siblings: string[],
  consumed: Set<string>,
  ordered: string[],
  resultId: string
): string[] {
  const order = siblings.filter((id) => !consumed.has(id));
  const at = siblings
    .slice(0, siblings.indexOf(ordered[0]))
    .filter((id) => !consumed.has(id)).length;
  order.splice(at, 0, resultId);
  return order;
}

export function createShapeOpsActions({ set, get, transact }: StoreCtx): ShapeOpsActions {
  return {
    convertSelectedToPaths: () => {
      const doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      const convertible = roots.filter((id) =>
        canConvertShapeToPath(doc.nodes[id])
      );
      if (!convertible.length) return;
      const nodes = { ...doc.nodes };
      for (const id of convertible) {
        const shape = nodes[id];
        if (canConvertShapeToPath(shape)) {
          if (shape.type === "compoundPath") {
            for (const childId of descendantNodeIds(doc, id)) {
              delete nodes[childId];
            }
          }
          nodes[id] = convertShapeToPath(shape, doc);
        }
      }
      const next = { ...doc, nodes };
      if (!hasValidSceneContainers(next)) return;
      transact(next, {
        label: convertible.length === 1 ? "Convert to path" : "Convert to paths",
      });
      set(clearTransient);
    },
    convertSelectedToBrushes: () => {
      let doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (!roots.some((id) => canConvertPathToBrush(doc.nodes[id]))) return;
      const selected: string[] = [];
      for (const id of roots) {
        const shape = doc.nodes[id];
        if (!canConvertPathToBrush(shape)) continue;
        const result = convertPathToBrush(shape);
        if (!result) continue;
        const parent = parentIdOf(doc, id);
        const siblings = childIdsOf(doc, parent);
        const nodes = { ...doc.nodes };
        delete nodes[id];
        for (const brush of result.brushes) nodes[brush.id] = brush;
        if (result.group) nodes[result.group.id] = result.group;
        // A single contour replaces the source in place; several arrive wrapped
        // in a group that takes the slot (a brush cannot hold sub-brushes).
        const replacement = result.group
          ? [result.group.id]
          : result.brushes.map((brush) => brush.id);
        const order = [...siblings];
        order.splice(siblings.indexOf(id), 1, ...replacement);
        doc = replaceChildren({ ...doc, nodes }, parent, order);
        selected.push(...replacement);
      }
      if (!selected.length || !hasValidSceneContainers(doc)) return;
      transact(doc, {
        label: selected.length === 1 ? "Convert to brush" : "Convert to brushes",
      });
      set({ selection: selected, ...clearTransient });
    },
    convertSelectedBrushesToOutline: () => {
      const doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      const convertible = roots.filter((id) =>
        canConvertBrushToOutline(doc.nodes[id])
      );
      if (!convertible.length) return;
      const nodes = { ...doc.nodes };
      let converted = 0;
      for (const id of convertible) {
        const shape = nodes[id];
        if (!canConvertBrushToOutline(shape)) continue;
        const outline = convertBrushToOutlinePath(shape);
        if (!outline) continue;
        nodes[id] = outline;
        converted++;
      }
      if (!converted) return;
      const next = { ...doc, nodes };
      if (!hasValidSceneContainers(next)) return;
      transact(next, {
        label: converted === 1 ? "Convert to outline path" : "Convert to outline paths",
      });
      set(clearTransient);
    },
    outlineStrokeSelected: () => {
      let doc = get().doc; const selected: string[] = []; let effectsRemoved = false; let maskSkipped = false;
      for (const id of selectionRoots(doc, get().selection)) {
        const shape = doc.nodes[id]; if (!isShape(shape) || !shape.stroke || shape.strokeWidth <= 0) continue;
        // A filled areal shape keeps its fill by wrapping the outline in a group,
        // which would replace a clipping mask with a non-mask container and leave
        // the clip group without a valid mask (see maskMultiNodeError).
        if (isAreal(shape) && shape.fill && isClippingMaskNode(doc, id)) { maskSkipped = true; continue; }
        const polys = strokeOutline(shape, undefined, doc); if (!polys?.length) continue;
        const outline: Shape = { id: makeId("path"), name: "Outline", type: "path", fillRule: "evenodd", subpaths: ringsToSubpaths(polys.flat()), ...baseShapeDefaults(), fill: shape.stroke, ...baseNodeDefaults(), opacity: shape.opacity, blendMode: shape.blendMode, transform: [...IDENTITY] };
        const parent = parentIdOf(doc, id); const siblings = childIdsOf(doc, parent); const at = siblings.indexOf(id); const nodes = { ...doc.nodes };
        if (isAreal(shape) && shape.fill) { const gid = makeId("group"); nodes[id] = { ...shape, stroke: null }; nodes[outline.id] = outline; nodes[gid] = groupNode(gid, [id, outline.id]); const order = [...siblings]; order.splice(at, 1, gid); doc = replaceChildren({ ...doc, nodes }, parent, order); selected.push(gid); }
        else { effectsRemoved ||= shape.effects.length > 0; for (const removed of [id, ...descendantNodeIds(doc, id)]) delete nodes[removed]; nodes[outline.id] = outline; const order = [...siblings]; order.splice(at, 1, outline.id); doc = replaceChildren({ ...doc, nodes }, parent, order); selected.push(outline.id); }
      }
      if (selected.length && hasValidSceneContainers(doc)) { transact(doc, { label: "Outline stroke" }); set({ selection: selected, ...clearTransient }); if (effectsRemoved) notifyEffectsRemoved(); }
      if (maskSkipped) notify.error(maskMultiNodeError("outlined"));
    },
    booleanSelected: (op) => {
      const doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (roots.length < 2 || !roots.every((id) => isShape(doc.nodes[id]))) return;
      const parent = parentIdOf(doc, roots[0]);
      if (!roots.every((id) => parentIdOf(doc, id) === parent)) return;
      const siblings = childIdsOf(doc, parent);
      const selected = new Set(roots);
      const ordered = siblings.filter((id) => selected.has(id));
      const effectsRemoved = ordered.some((id) => !!doc.nodes[id]?.effects.length);
      const result = booleanShapes(ordered.map((id) => doc.nodes[id] as Shape), op, doc);
      if (!result) return;
      const nodes = { ...doc.nodes };
      for (const id of roots.flatMap((root) => [root, ...descendantNodeIds(doc, root)])) delete nodes[id];
      nodes[result.id] = result;
      const next = replaceChildren(
        { ...doc, nodes },
        parent,
        collapseSiblings(siblings, selected, ordered, result.id)
      );
      if (!hasValidSceneContainers(next)) return;
      transact(next, { label: `Boolean ${op}` });
      set({ selection: [result.id], ...clearTransient });
      if (effectsRemoved) notifyEffectsRemoved();
    },
    divideSelected: () => {
      const doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (
        roots.length < 2 ||
        !roots.every((id) => {
          const node = doc.nodes[id];
          return isShape(node) && isAreal(node);
        })
      )
        return;
      const parent = parentIdOf(doc, roots[0]);
      if (!roots.every((id) => parentIdOf(doc, id) === parent)) return;
      const siblings = childIdsOf(doc, parent);
      const selected = new Set(roots);
      const ordered = siblings.filter((id) => selected.has(id));
      // Divide wraps its faces in a group, which would replace a clipping mask
      // with a non-mask container and leave the clip group without a valid mask
      // (see maskMultiNodeError).
      if (ordered.some((id) => isClippingMaskNode(doc, id))) {
        notify.error(maskMultiNodeError("divided"));
        return;
      }
      if (ordered.length > DIVIDE_MAX_INPUTS) {
        notify.error(
          `Divide is limited to ${DIVIDE_MAX_INPUTS} shapes at once.`
        );
        return;
      }
      const effectsRemoved = ordered.some((id) => !!doc.nodes[id]?.effects.length);
      const faces = divideShapes(ordered.map((id) => doc.nodes[id] as Shape), doc);
      if (!faces) return;
      const nodes = { ...doc.nodes };
      for (const id of ordered.flatMap((r) => [r, ...descendantNodeIds(doc, r)]))
        delete nodes[id];
      for (const face of faces) nodes[face.id] = face;
      const gid = makeId("group");
      nodes[gid] = groupNode(gid, faces.map((face) => face.id));
      const next = replaceChildren(
        { ...doc, nodes },
        parent,
        collapseSiblings(siblings, selected, ordered, gid)
      );
      if (!hasValidSceneContainers(next)) return;
      transact(next, { label: "Divide" });
      set({ selection: [gid], ...clearTransient });
      if (effectsRemoved) notifyEffectsRemoved();
    },
    combineSelected: () => {
      const doc = get().doc;
      const selection = get().selection;
      if (!canCombineSelection(doc, selection)) return;
      const roots = selectionRoots(doc, selection);
      const parent = parentIdOf(doc, roots[0]);
      const siblings = childIdsOf(doc, parent);
      const selected = new Set(roots);
      const ordered = siblings.filter((id) => selected.has(id));
      // A selected group is consumed whole, so its contents count too.
      const consumed = ordered.flatMap((id) => [id, ...descendantNodeIds(doc, id)]);
      // Combining the mask with anything would leave the clip group without a
      // mask or without content (see maskMultiNodeError); a consumed clip group
      // would lose its clip the same way.
      if (consumed.some((id) => isClippingMaskNode(doc, id))) {
        notify.error(maskMultiNodeError("combined"));
        return;
      }
      // The result is one node with one hidden/locked flag, so a member
      // carrying either would come back visible or be edited despite its lock
      // — most easily reached by selecting a group whose contents are.
      const blocked = combineBlockedFlags(doc, consumed);
      if (blocked) {
        notify.error(blocked);
        return;
      }
      const inputs = combineInputs(doc, ordered, parent);
      if (!inputs) return;
      const effectsRemoved = consumed.some((id) => !!doc.nodes[id]?.effects.length);
      const combined = combineShapes(inputs);
      if (!combined) return;
      // A consumed group's opacity applied to its flattened contents as a
      // whole, which is exactly what the single result node does with it.
      const groupOpacity = consumed.reduce((acc, id) => {
        const node = doc.nodes[id];
        return isGroup(node) ? acc * node.opacity : acc;
      }, 1);
      const result = groupOpacity === 1
        ? combined
        : { ...combined, opacity: combined.opacity * groupOpacity };
      const nodes = { ...doc.nodes };
      for (const id of consumed) delete nodes[id];
      nodes[result.id] = result;
      const next = replaceChildren(
        { ...doc, nodes },
        parent,
        collapseSiblings(siblings, selected, ordered, result.id)
      );
      if (!hasValidSceneContainers(next)) return;
      transact(next, { label: "Combine paths" });
      set({ selection: [result.id], ...clearTransient });
      if (effectsRemoved) notifyEffectsRemoved();
    },
    joinSelected: () => {
      const doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      const pathRoots = roots.filter((id) => doc.nodes[id]?.type === "path");
      if (!pathRoots.length || pathRoots.length !== roots.length) return;
      const parent = parentIdOf(doc, pathRoots[0]);
      if (!pathRoots.every((id) => parentIdOf(doc, id) === parent)) return;
      const siblings = childIdsOf(doc, parent);
      const selected = new Set(pathRoots);
      const ordered = siblings.filter((id) => selected.has(id));
      const effectsRemoved = ordered.some((id) => !!doc.nodes[id]?.effects.length);
      const result = joinShapes(ordered.map((id) => doc.nodes[id] as PathShape));
      if (!result) {
        notify.error("No path ends were close enough to join.");
        return;
      }
      const nodes = { ...doc.nodes };
      for (const id of ordered) delete nodes[id];
      nodes[result.id] = result;
      const next = replaceChildren(
        { ...doc, nodes },
        parent,
        collapseSiblings(siblings, selected, ordered, result.id)
      );
      if (!hasValidSceneContainers(next)) return;
      transact(next, { label: "Join path" });
      set({ selection: [result.id], ...clearTransient });
      if (effectsRemoved) notifyEffectsRemoved();
    },
    splitSubpathsSelected: () => {
      let doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (!roots.some((id) => canSplitSubpaths(doc.nodes[id]))) return;
      const selected: string[] = [];
      let maskSkipped = false;
      for (const id of roots) {
        const shape = doc.nodes[id];
        if (!canSplitSubpaths(shape)) continue;
        // Splitting always yields several nodes, so a mask can never be split
        // (see maskMultiNodeError).
        if (isClippingMaskNode(doc, id)) {
          maskSkipped = true;
          continue;
        }
        const result = splitSubpaths(shape);
        if (!result) continue;
        const parent = parentIdOf(doc, id);
        const siblings = childIdsOf(doc, parent);
        const nodes = { ...doc.nodes };
        delete nodes[id];
        // Subpaths are drawn back-to-front, matching childIds order, so the
        // pieces keep their order in the slot the source held. They normally
        // arrive wrapped in a group; a compound path parent takes them flat
        // because it accepts areal leaves only.
        const flat = isCompoundPath(doc.nodes[parent ?? ""])
          ? flattenSplitPieces(result)
          : null;
        const inserted = flat ?? result.pieces;
        for (const piece of inserted) nodes[piece.id] = piece;
        if (!flat) nodes[result.group.id] = result.group;
        const order = [...siblings];
        order.splice(
          siblings.indexOf(id),
          1,
          ...(flat ? flat.map((piece) => piece.id) : [result.group.id])
        );
        doc = replaceChildren({ ...doc, nodes }, parent, order);
        selected.push(...(flat ? flat.map((piece) => piece.id) : [result.group.id]));
      }
      if (maskSkipped) notify.error(maskMultiNodeError("split"));
      if (!selected.length || !hasValidSceneContainers(doc)) return;
      transact(doc, { label: "Split subpaths" });
      set({ selection: selected, ...clearTransient });
    },
    makeCompoundPathSelected: () => {
      const doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (!canMakeCompoundPathSelection(doc, roots)) return;
      const parent = parentIdOf(doc, roots[0]);
      const siblings = childIdsOf(doc, parent);
      const selected = new Set(roots);
      const ordered = siblings.filter((id) => selected.has(id));
      const effectsRemoved = ordered.some((id) => !!doc.nodes[id]?.effects.length);
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
      const next = replaceChildren(
        { ...doc, nodes },
        parent,
        collapseSiblings(siblings, selected, ordered, compound.id)
      );
      if (!hasValidSceneContainers(next)) return;
      transact(next, { label: "Make compound path" });
      set({ selection: [compound.id], ...clearTransient });
      if (effectsRemoved) notifyEffectsRemoved();
    },
    releaseCompoundPathSelected: () => {
      let doc = get().doc;
      const roots = selectionRoots(doc, get().selection);
      if (!canReleaseCompoundPathSelection(doc, roots)) return;
      const selected: string[] = [];
      let effectsRemoved = false;
      let maskSkipped = false;
      for (const id of roots) {
        const compound = doc.nodes[id];
        if (!compound || compound.type !== "compoundPath") continue;
        const parent = parentIdOf(doc, id);
        const siblings = childIdsOf(doc, parent);
        const at = siblings.indexOf(id);
        const released = releaseCompoundPath(doc, compound);
        // Releasing a mask into several shapes would rewrite the clip (see
        // maskMultiNodeError). A lone child replaces the mask one-for-one, so
        // that case stays allowed.
        if (released.length > 1 && isClippingMaskNode(doc, id)) {
          maskSkipped = true;
          continue;
        }
        effectsRemoved ||= compound.effects.length > 0;
        const nodes = { ...doc.nodes };
        delete nodes[id];
        for (const shape of released) nodes[shape.id] = shape;
        const order = [...siblings];
        order.splice(at, 1, ...released.map((shape) => shape.id));
        doc = replaceChildren({ ...doc, nodes }, parent, order);
        selected.push(...released.map((shape) => shape.id));
      }
      if (maskSkipped) notify.error(maskMultiNodeError("released"));
      if (selected.length && hasValidSceneContainers(doc)) {
        transact(doc, { label: "Release compound path" });
        set({ selection: selected, ...clearTransient });
        if (effectsRemoved) notifyEffectsRemoved();
      }
    },
  };
}
