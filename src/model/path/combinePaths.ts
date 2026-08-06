import {
  IDENTITY,
  invertMatrix,
  isIdentity,
  multiply,
  nodeWorldMatrix,
} from "@/model/geometry/matrix";
import { isGroup, parentIdOf, selectionRoots } from "../scene";
import { strokeDetailFields } from "../stroke";
import { transformSubpath } from "./path";
import { convertShapeToPath } from "./convertToPath";
import { resolvedSubpaths } from "./pathModifiers";
import {
  baseNodeDefaults,
  makeId,
  type Document,
  type EllipseShape,
  type LineShape,
  type Matrix,
  type PathShape,
  type RectShape,
  type SceneNode,
} from "../types";

/**
 * What may feed a combine. The parametric primitives join in because
 * `convertShapeToPath` reproduces their geometry exactly; a brush stays out
 * because its path form is either a centerline (losing the varying width) or
 * an envelope outline (a different shape than the one drawn).
 */
export type CombinableShape = PathShape | RectShape | EllipseShape | LineShape;

export const isCombinableShape = (
  node: SceneNode | undefined
): node is CombinableShape =>
  node?.type === "path" ||
  node?.type === "rect" ||
  node?.type === "ellipse" ||
  node?.type === "line";

/**
 * The leaves one selected node contributes, in paint order — itself, or every
 * descendant when it is a group, so selecting a group combines its contents
 * (the one-step inverse of `splitSubpaths`, whose result is such a group).
 * Null when anything inside cannot be combined, since a group is all-or-nothing.
 */
export function combineLeafIds(doc: Document, id: string): string[] | null {
  const node = doc.nodes[id];
  if (!isGroup(node)) return isCombinableShape(node) ? [id] : null;
  const leaves: string[] = [];
  for (const childId of node.childIds) {
    const nested = combineLeafIds(doc, childId);
    if (!nested) return null;
    leaves.push(...nested);
  }
  return leaves;
}

/**
 * Whether the selection can be combined: sibling nodes contributing at least
 * two combinable leaves between them. Same-parent is required because the
 * result lives in one coordinate space, like the boolean ops and `joinShapes`.
 */
export function canCombineSelection(doc: Document, selection: string[]): boolean {
  const roots = selectionRoots(doc, selection);
  if (!roots.length) return false;
  const parent = parentIdOf(doc, roots[0]);
  if (!roots.every((id) => parentIdOf(doc, id) === parent)) return false;
  let leaves = 0;
  for (const id of roots) {
    const ids = combineLeafIds(doc, id);
    if (!ids) return false;
    leaves += ids.length;
  }
  return leaves >= 2;
}

/**
 * The path inputs `ordered` (siblings in back-to-front order) stand for, ready
 * for {@link combineShapes}: primitives converted, and leaves that sat inside a
 * selected group re-expressed in `parent`'s space, which is where the result
 * lands. Null when something is not combinable or the parent space is
 * degenerate.
 */
export function combineInputs(
  doc: Document,
  ordered: string[],
  parent: string | null
): PathShape[] | null {
  const intoParent = invertMatrix(nodeWorldMatrix(doc, parent));
  const inputs: PathShape[] = [];
  for (const rootId of ordered) {
    const leafIds = combineLeafIds(doc, rootId);
    if (!leafIds) return null;
    for (const leafId of leafIds) {
      const shape = doc.nodes[leafId] as CombinableShape;
      const path = shape.type === "path" ? shape : convertShapeToPath(shape, doc);
      if (parentIdOf(doc, leafId) === parent) {
        inputs.push(path);
        continue;
      }
      if (!intoParent) return null;
      inputs.push({
        ...path,
        transform: multiply(intoParent, nodeWorldMatrix(doc, leafId)),
      });
    }
  }
  return inputs;
}

/**
 * Gather several paths into one multi-subpath path, concatenating their
 * contours back-to-front. Unlike {@link joinShapes} this welds nothing and
 * changes no geometry — it is purely a re-containering, and the exact inverse
 * of `splitSubpaths`.
 *
 * It exists because **open contours have no other container**: a compound path
 * accepts only closed children, and join only connects endpoints that already
 * fall within its tolerance. Without this, a drawing made of several open
 * strokes cannot be one node with one style, one transform and one selection
 * unit.
 *
 * Appearance comes from the **backmost** input (`shapes[0]`, callers pass them
 * in sibling order), matching `joinShapes` and `makeCompoundPath`; the other
 * inputs' fill, stroke and opacity are dropped. Effects are dropped like join
 * does, and any generator link goes with them. Returns null with fewer than
 * two inputs.
 *
 * The result therefore also **keeps the backmost input's transform** rather
 * than baking everything flat the way boolean/outline/join do: `strokeWidth`
 * and `strokeDash` are node-local units that the renderer scales by the node's
 * transform, so baking a scaled transform away would silently change the line
 * weight of the very shape whose style the result adopts. The other inputs are
 * mapped into that space instead. A non-invertible base transform is the one
 * case that falls back to baking into the parent space.
 */
export function combineShapes(shapes: PathShape[]): PathShape | null {
  if (shapes.length < 2) return null;
  const base = shapes[0];
  const intoBase = invertMatrix(base.transform);
  const transform: Matrix = intoBase ? [...base.transform] : [...IDENTITY];
  return {
    id: makeId("path"),
    name: "Combined path",
    type: "path",
    subpaths: shapes.flatMap((shape) => {
      // Base-space contours pass through untouched; the rest are re-expressed
      // in it (parent space when the base transform cannot be inverted).
      const m = intoBase ? multiply(intoBase, shape.transform) : shape.transform;
      const subpaths = resolvedSubpaths(shape);
      return isIdentity(m)
        ? subpaths.map((sp) => structuredClone(sp))
        : subpaths.map((sp) => transformSubpath(m, sp));
    }),
    // Irrelevant to the open contours this exists for; kept from the base so a
    // closed input keeps filling the way it did.
    fillRule: base.fillRule,
    fill: base.fill,
    stroke: base.stroke,
    strokeWidth: base.strokeWidth,
    ...strokeDetailFields(base),
    ...baseNodeDefaults(),
    opacity: base.opacity,
    blendMode: base.blendMode,
    transform,
    transformOrigin: base.transformOrigin
      ? { ...base.transformOrigin }
      : null,
  };
}
