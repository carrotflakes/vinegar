import { convertBrushToCenterlinePath } from "@/model/brush/convertBrush";
import { applyPathModifiers, prefixSubpaths } from "./pathModifiers";
import { hasVectorGeometry, shapeFillRule, shapeSubpaths } from "./shapeGeometry";
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
  type TextShape,
} from "../types";

export type PathConvertibleShape =
  | RectShape
  | EllipseShape
  | LineShape
  | BrushShape
  | CompoundPathNode
  | TextShape;

export function canConvertShapeToPath(
  node: SceneNode | undefined
): node is PathConvertibleShape {
  // Outlining text is only offered once the glyphs are actually available:
  // a system font, or a font still loading, has nothing to convert yet.
  if (node?.type === "text") return hasVectorGeometry(node);
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
 * appearance-preserving envelope direction. Text becomes its glyph outlines
 * ("create outlines"), which is a one-way trip: the string, the font and the
 * wrapping are gone once the letters are contours.
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
 * go away with the stages they addressed; bindings onto the stages that survive
 * follow them to their new indices.
 *
 * `count` bakes only the first stages — applying one modifier necessarily
 * applies everything before it, and the rest of the stack stays live on top of
 * the frozen geometry, so the painted result is unchanged.
 */
export function applyShapeModifiers(
  shape: PrimitiveShape,
  doc: Document,
  count = Number.POSITIVE_INFINITY
): PrimitiveShape {
  const modifiers = shape.modifiers ?? [];
  const baked = Math.min(count, modifiers.length);
  if (baked <= 0) return shape;
  const moved = new Map<number, number>();
  modifiers.forEach((_, index) => {
    if (index >= baked) moved.set(index, index - baked);
  });
  const shaped = shape.type === "path"
    ? applyPathModifiers(shape, baked)
    : {
      ...convertShapeToPath(shape, doc),
      subpaths: prefixSubpaths(shape, baked),
      modifiers: modifiers.slice(baked),
    };
  return { ...shaped, bindings: remapModifierBindings(shape.bindings, moved) };
}
