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
import { acceptsScene } from "./sceneGuard";
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
  type SceneNode,
  type Shape,
} from "../model/types";
import {
  collapseSiblings,
  groupNode,
  replaceChildren,
  replaceNodeWith,
} from "./docOps";
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

/** The selected roots in paint order, with the parent they share. */
interface OrderedSelection {
  parent: string | null;
  siblings: string[];
  /** The roots, back-to-front. */
  ordered: string[];
}

/**
 * The selected roots as one ordered group, or null when they cannot act as one
 * — fewer than `min`, not all siblings, or failing `accepts`. Every op that
 * collapses a selection into a single result starts here.
 */
function orderedSelection(
  doc: Document,
  selection: string[],
  min: number,
  accepts?: (node: SceneNode | undefined) => boolean
): OrderedSelection | null {
  const roots = selectionRoots(doc, selection);
  if (roots.length < min) return null;
  if (accepts && !roots.every((id) => accepts(doc.nodes[id]))) return null;
  const parent = parentIdOf(doc, roots[0]);
  if (!roots.every((id) => parentIdOf(doc, id) === parent)) return null;
  const siblings = childIdsOf(doc, parent);
  const selected = new Set(roots);
  const ordered = siblings.filter((id) => selected.has(id));
  if (ordered.length !== roots.length) return null;
  return { parent, siblings, ordered };
}

export function createShapeOpsActions({ set, get, transact }: StoreCtx): ShapeOpsActions {
  /**
   * Commit an op that collapsed the selection into one result node, which takes
   * the frontmost consumed slot: validate, land one undo step, select the
   * result, and report any effects the collapse dropped.
   *
   * `consumed` ids leave the parent's child list. They are also deleted unless
   * `removed` narrows that — Make Compound Path consumes its inputs from the
   * parent but keeps them alive as the compound's children.
   */
  const commitCollapse = (
    doc: Document,
    { parent, siblings, ordered }: OrderedSelection,
    op: {
      consumed: string[];
      removed?: string[];
      added: SceneNode[];
      resultId: string;
      label: string;
    }
  ): void => {
    const effectsRemoved = op.consumed.some(
      (id) => !!doc.nodes[id]?.effects.length
    );
    const nodes = { ...doc.nodes };
    for (const id of op.removed ?? op.consumed) delete nodes[id];
    for (const node of op.added) nodes[node.id] = node;
    const next = replaceChildren(
      { ...doc, nodes },
      parent,
      collapseSiblings(siblings, new Set(op.consumed), ordered, op.resultId)
    );
    if (!acceptsScene(next)) return;
    transact(next, { label: op.label });
    set({ selection: [op.resultId], ...clearTransient });
    if (effectsRemoved) notifyEffectsRemoved();
  };

  /**
   * Commit an op that rewrote nodes one at a time (see `replaceNodeWith`).
   * Does nothing when the op produced no nodes or an illegal document.
   */
  const commitReplacements = (
    doc: Document,
    selection: string[],
    label: string,
    effectsRemoved = false
  ): void => {
    if (!selection.length || !acceptsScene(doc)) return;
    transact(doc, { label });
    set({ selection, ...clearTransient });
    if (effectsRemoved) notifyEffectsRemoved();
  };

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
      if (!acceptsScene(next)) return;
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
        // A single contour replaces the source in place; several arrive wrapped
        // in a group that takes the slot (a brush cannot hold sub-brushes).
        const replacement = result.group
          ? [result.group.id]
          : result.brushes.map((brush) => brush.id);
        doc = replaceNodeWith(
          doc,
          id,
          [...result.brushes, ...(result.group ? [result.group] : [])],
          replacement
        );
        selected.push(...replacement);
      }
      commitReplacements(
        doc,
        selected,
        selected.length === 1 ? "Convert to brush" : "Convert to brushes"
      );
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
      if (!acceptsScene(next)) return;
      transact(next, {
        label: converted === 1 ? "Convert to outline path" : "Convert to outline paths",
      });
      set(clearTransient);
    },
    outlineStrokeSelected: () => {
      let doc = get().doc;
      const selected: string[] = [];
      let effectsRemoved = false;
      let maskSkipped = false;
      for (const id of selectionRoots(doc, get().selection)) {
        const shape = doc.nodes[id];
        if (!isShape(shape) || !shape.stroke || shape.strokeWidth <= 0) continue;
        // A filled areal shape keeps its fill by wrapping the outline in a group,
        // which would replace a clipping mask with a non-mask container and leave
        // the clip group without a valid mask (see maskMultiNodeError).
        const wraps = isAreal(shape) && !!shape.fill;
        if (wraps && isClippingMaskNode(doc, id)) {
          maskSkipped = true;
          continue;
        }
        const polys = strokeOutline(shape, undefined, doc);
        if (!polys?.length) continue;
        const outline: Shape = {
          id: makeId("path"),
          name: "Outline",
          type: "path",
          fillRule: "evenodd",
          subpaths: ringsToSubpaths(polys.flat()),
          ...baseShapeDefaults(),
          fill: shape.stroke,
          ...baseNodeDefaults(),
          opacity: shape.opacity,
          blendMode: shape.blendMode,
          transform: [...IDENTITY],
        };
        if (wraps) {
          // Re-stating the source keeps it (and any subtree) alive inside the
          // new group, which takes its slot.
          const gid = makeId("group");
          doc = replaceNodeWith(
            doc,
            id,
            [{ ...shape, stroke: null }, outline, groupNode(gid, [id, outline.id])],
            [gid]
          );
          selected.push(gid);
        } else {
          effectsRemoved ||= shape.effects.length > 0;
          doc = replaceNodeWith(doc, id, [outline], [outline.id]);
          selected.push(outline.id);
        }
      }
      commitReplacements(doc, selected, "Outline stroke", effectsRemoved);
      if (maskSkipped) notify.error(maskMultiNodeError("outlined"));
    },
    booleanSelected: (op) => {
      const doc = get().doc;
      const sel = orderedSelection(doc, get().selection, 2, isShape);
      if (!sel) return;
      const result = booleanShapes(
        sel.ordered.map((id) => doc.nodes[id] as Shape),
        op,
        doc
      );
      if (!result) return;
      commitCollapse(doc, sel, {
        consumed: sel.ordered.flatMap((id) => [id, ...descendantNodeIds(doc, id)]),
        added: [result],
        resultId: result.id,
        label: `Boolean ${op}`,
      });
    },
    divideSelected: () => {
      const doc = get().doc;
      const sel = orderedSelection(
        doc,
        get().selection,
        2,
        (node) => !!node && isShape(node) && isAreal(node)
      );
      if (!sel) return;
      // Divide wraps its faces in a group, which would replace a clipping mask
      // with a non-mask container and leave the clip group without a valid mask
      // (see maskMultiNodeError).
      if (sel.ordered.some((id) => isClippingMaskNode(doc, id))) {
        notify.error(maskMultiNodeError("divided"));
        return;
      }
      if (sel.ordered.length > DIVIDE_MAX_INPUTS) {
        notify.error(
          `Divide is limited to ${DIVIDE_MAX_INPUTS} shapes at once.`
        );
        return;
      }
      const faces = divideShapes(
        sel.ordered.map((id) => doc.nodes[id] as Shape),
        doc
      );
      if (!faces) return;
      const gid = makeId("group");
      commitCollapse(doc, sel, {
        consumed: sel.ordered.flatMap((id) => [id, ...descendantNodeIds(doc, id)]),
        added: [...faces, groupNode(gid, faces.map((face) => face.id))],
        resultId: gid,
        label: "Divide",
      });
    },
    combineSelected: () => {
      const doc = get().doc;
      const selection = get().selection;
      if (!canCombineSelection(doc, selection)) return;
      const sel = orderedSelection(doc, selection, 1);
      if (!sel) return;
      const { parent, ordered } = sel;
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
      commitCollapse(doc, sel, {
        consumed,
        added: [result],
        resultId: result.id,
        label: "Combine paths",
      });
    },
    joinSelected: () => {
      const doc = get().doc;
      const sel = orderedSelection(
        doc,
        get().selection,
        1,
        (node) => node?.type === "path"
      );
      if (!sel) return;
      const result = joinShapes(
        sel.ordered.map((id) => doc.nodes[id] as PathShape)
      );
      if (!result) {
        notify.error("No path ends were close enough to join.");
        return;
      }
      commitCollapse(doc, sel, {
        consumed: sel.ordered,
        added: [result],
        resultId: result.id,
        label: "Join path",
      });
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
        // Subpaths are drawn back-to-front, matching childIds order, so the
        // pieces keep their order in the slot the source held. They normally
        // arrive wrapped in a group; a compound path parent takes them flat
        // because it accepts areal leaves only.
        const flat = isCompoundPath(doc.nodes[parentIdOf(doc, id) ?? ""])
          ? flattenSplitPieces(result)
          : null;
        const slotIds = flat
          ? flat.map((piece) => piece.id)
          : [result.group.id];
        doc = replaceNodeWith(
          doc,
          id,
          flat ?? [...result.pieces, result.group],
          slotIds
        );
        selected.push(...slotIds);
      }
      if (maskSkipped) notify.error(maskMultiNodeError("split"));
      commitReplacements(doc, selected, "Split subpaths");
    },
    makeCompoundPathSelected: () => {
      const doc = get().doc;
      const sel = orderedSelection(doc, get().selection, 1);
      if (!sel || !canMakeCompoundPathSelection(doc, sel.ordered)) return;
      const compound = makeCompoundPath(
        sel.ordered.map((id) => doc.nodes[id] as Shape)
      );
      if (!compound) return;
      // A selected compound is absorbed rather than nested: its container goes
      // away, so its children have to carry the transform it was applying.
      const rebased = sel.ordered.flatMap((id) => {
        const node = doc.nodes[id];
        if (!isCompoundPath(node)) return [];
        return node.childIds.flatMap((childId) => {
          const child = doc.nodes[childId];
          return child
            ? [{ ...child, transform: multiply(node.transform, child.transform) }]
            : [];
        });
      });
      commitCollapse(doc, sel, {
        consumed: sel.ordered,
        // The inputs live on as the compound's children; only an absorbed
        // compound container itself goes away.
        removed: sel.ordered.filter((id) => isCompoundPath(doc.nodes[id])),
        added: [...rebased, compound],
        resultId: compound.id,
        label: "Make compound path",
      });
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
        const released = releaseCompoundPath(doc, compound);
        // Releasing a mask into several shapes would rewrite the clip (see
        // maskMultiNodeError). A lone child replaces the mask one-for-one, so
        // that case stays allowed.
        if (released.length > 1 && isClippingMaskNode(doc, id)) {
          maskSkipped = true;
          continue;
        }
        effectsRemoved ||= compound.effects.length > 0;
        const ids = released.map((shape) => shape.id);
        doc = replaceNodeWith(doc, id, released, ids);
        selected.push(...ids);
      }
      if (maskSkipped) notify.error(maskMultiNodeError("released"));
      commitReplacements(doc, selected, "Release compound path", effectsRemoved);
    },
  };
}
