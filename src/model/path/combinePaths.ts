import {
  IDENTITY,
  invertMatrix,
  isIdentity,
  multiply,
} from "@/model/geometry/matrix";
import { parentIdOf, selectionRoots } from "../scene";
import { strokeDetailFields } from "../stroke";
import { transformSubpath } from "./path";
import { resolvedSubpaths } from "./pathModifiers";
import {
  baseNodeDefaults,
  makeId,
  type Document,
  type Matrix,
  type PathShape,
} from "../types";

/**
 * Whether the selection can be combined: at least two sibling path nodes.
 * Same-parent is required because the result lives in one coordinate space,
 * like the boolean ops and `joinShapes`.
 */
export function canCombineSelection(doc: Document, selection: string[]): boolean {
  const roots = selectionRoots(doc, selection);
  if (roots.length < 2) return false;
  const parent = parentIdOf(doc, roots[0]);
  return roots.every(
    (id) => doc.nodes[id]?.type === "path" && parentIdOf(doc, id) === parent
  );
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
export function combineShapes(shapes: PathShape[], doc?: Document): PathShape | null {
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
      const subpaths = resolvedSubpaths(shape, doc);
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
