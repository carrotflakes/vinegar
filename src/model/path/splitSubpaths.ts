import { IDENTITY } from "@/model/geometry/matrix";
import {
  baseNodeDefaults,
  makeId,
  nodeAppearanceFields,
  type Group,
  type PathShape,
  type SceneNode,
} from "../types";
import { resolvedSubpaths } from "./pathModifiers";

/**
 * Whether the node is a path holding more than one contour, i.e. splitting it
 * would produce separate shapes. Note that `joinShapes` (`path.join`) is not a
 * true inverse: it only welds *open* ends that fall within its tolerance, so
 * split-then-join does not put separate closed contours back together — undo
 * or `structure.makeCompound` is the way back.
 */
export function canSplitSubpaths(
  node: SceneNode | undefined
): node is PathShape {
  return !!node && node.type === "path" && resolvedSubpaths(node).length > 1;
}

export interface SplitSubpathsResult {
  /** Replaces the source node in its slot; owns the pieces. */
  group: Group;
  /** One path per contour, back-to-front, in the group's local space. */
  pieces: PathShape[];
}

/**
 * Break a multi-subpath path into one path shape per contour, wrapped in a
 * group that takes the source's slot. Grouping keeps a path with many contours
 * (an imported trace or glyph outline can have hundreds) as one collapsible
 * layer row instead of flooding the panel.
 *
 * The group inherits everything that composites the shape as a whole —
 * `transform`, `transformOrigin`, opacity, blend mode, effects, hidden/locked —
 * and the pieces are left neutral (identity transform, opacity 1, normal
 * blend, no effects). Because a group renders to one offscreen layer, this
 * reproduces the source's appearance exactly: overlaps do not darken under a
 * partial opacity, and blur/shadow radii and stroke widths stay in the same
 * space, since local units still scale through the group's transform.
 *
 * Returns null when there is nothing to split. `generator` links are dropped:
 * the pieces no longer match the generator's output.
 *
 * The one loss is deliberate: contours that described **holes** through the
 * fill rule become independently filled shapes. `structure.makeCompound`
 * restores that reading (a group cannot express it).
 */
/**
 * The same pieces without the wrapping group, for a parent that cannot hold
 * one: a compound path accepts only areal leaves, and it already owns the
 * appearance its children's paint fields are ignored in favour of — so folding
 * the group's state back onto each piece is lossless there.
 */
export function flattenSplitPieces(result: SplitSubpathsResult): PathShape[] {
  const { group, pieces } = result;
  return pieces.map((piece) => ({
    ...piece,
    transform: [...group.transform],
    transformOrigin: group.transformOrigin,
    ...nodeAppearanceFields(group),
  }));
}

export function splitSubpaths(shape: PathShape): SplitSubpathsResult | null {
  const subpaths = resolvedSubpaths(shape);
  if (subpaths.length < 2) return null;
  const pieces = subpaths.map((sp, i) => ({
    ...structuredClone(shape),
    ...baseNodeDefaults(),
    id: makeId("path"),
    name: `${shape.name} ${i + 1}`,
    subpaths: [structuredClone(sp)],
    modifiers: [],
    transform: [...IDENTITY] as PathShape["transform"],
  }));
  const group: Group = {
    id: makeId("group"),
    name: shape.name,
    type: "group",
    clipsToMask: false,
    bindings: {},
    childIds: pieces.map((piece) => piece.id),
    transform: [...shape.transform],
    transformOrigin: shape.transformOrigin,
    ...nodeAppearanceFields(shape),
    generator: null,
  };
  return { group, pieces };
}
