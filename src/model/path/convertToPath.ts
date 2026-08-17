import { convertBrushToCenterlinePath } from "@/model/brush/convertBrush";
import { applyPathModifiers } from "./pathModifiers";
import { shapeFillRule, shapeSubpaths } from "./shapeGeometry";
import { remapModifierBindings } from "../params";
import { markerFields } from "../marker";
import { shapePaintFields } from "../stroke";
import {
  nodeAppearanceFields,
  type CompoundPathNode,
  type BrushShape,
  type Document,
  type EllipseShape,
  type LineShape,
  type PathShape,
  type PrimitiveShape,
  type RectShape,
  type SceneNode,
} from "../types";

export type PathConvertibleShape =
  | RectShape
  | EllipseShape
  | LineShape
  | BrushShape
  | CompoundPathNode;

export function canConvertShapeToPath(
  node: SceneNode | undefined
): node is PathConvertibleShape {
  return node?.type === "rect" ||
    node?.type === "ellipse" ||
    node?.type === "line" ||
    node?.type === "brush" ||
    node?.type === "compoundPath";
}

/**
 * Convert supported shape geometry to an editable path without changing its
 * meaning. A brush becomes its centerline as a uniform-width stroked path (the
 * faithful geometry conversion); `convertBrushToOutlinePath` is the separate,
 * appearance-preserving envelope direction.
 */
export function convertShapeToPath(
  shape: PathConvertibleShape,
  doc: Document
): PathShape {
  if (shape.type === "brush") return convertBrushToCenterlinePath(shape);
  const subpaths = shapeSubpaths(shape, doc) ?? [];
  return {
    id: shape.id,
    name: shape.name,
    type: "path",
    subpaths,
    fillRule: shapeFillRule(shape),
    ...shapePaintFields(shape),
    // A converted line keeps its end markers: they attach to the resolved
    // geometry, which this conversion preserves.
    ...markerFields(shape),
    ...nodeAppearanceFields(shape),
    generator: shape.generator,
    // The stack is baked into `subpaths` here, so bindings onto its stages
    // have nothing left to address.
    bindings: remapModifierBindings(shape.bindings, new Map()),
    transform: [...shape.transform],
    transformOrigin: shape.transformOrigin ? { ...shape.transformOrigin } : null,
  };
}

/**
 * Bake a modifier stack into base geometry. A path absorbs the result into its
 * own anchors; a rect/ellipse/line cannot express an offset or outlined
 * silhouette, so baking converts it to a path. Bindings onto the baked stages
 * go away with the stages they addressed.
 */
export function applyShapeModifiers(
  shape: PrimitiveShape,
  doc: Document
): PrimitiveShape {
  if (!shape.modifiers?.length) return shape;
  const baked = shape.type === "path"
    ? applyPathModifiers(shape)
    : convertShapeToPath(shape, doc);
  return { ...baked, bindings: remapModifierBindings(baked.bindings, new Map()) };
}
