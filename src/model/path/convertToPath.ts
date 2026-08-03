import { compoundChildren } from "./compoundPath";
import { convertBrushToCenterlinePath } from "@/model/brush/convertBrush";
import { ellipseSubpath } from "../ellipse";
import { roundedRectSubpath } from "../roundedRect";
import { transformSubpath } from "./path";
import { resolvedSubpaths } from "./pathModifiers";
import { strokeDetailFields } from "../stroke";
import type {
  CompoundPathNode,
  BrushShape,
  Document,
  EllipseShape,
  LineShape,
  PathShape,
  PathSubpath,
  PrimitiveShape,
  RectShape,
  SceneNode,
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

function lineSubpath(shape: LineShape): PathSubpath {
  return {
    closed: false,
    anchors: [
      { p: { x: shape.x1, y: shape.y1 }, hIn: null, hOut: null },
      { p: { x: shape.x2, y: shape.y2 }, hIn: null, hOut: null },
    ],
  };
}

function primitiveSubpaths(shape: PrimitiveShape, doc?: Document): PathSubpath[] {
  switch (shape.type) {
    case "rect":
      return [roundedRectSubpath(shape)];
    case "ellipse":
      return [ellipseSubpath(shape)];
    case "line":
      return [lineSubpath(shape)];
    case "path":
      return resolvedSubpaths(shape, doc);
  }
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
  const subpaths = shape.type === "compoundPath"
    ? compoundChildren(doc, shape).flatMap((child) =>
        primitiveSubpaths(child).map((subpath) =>
          transformSubpath(child.transform, subpath)
        )
      )
    : primitiveSubpaths(shape);
  return {
    id: shape.id,
    name: shape.name,
    type: "path",
    subpaths,
    fillRule: shape.type === "compoundPath" ? "evenodd" : "nonzero",
    fill: shape.fill,
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    ...strokeDetailFields(shape),
    opacity: shape.opacity,
    blendMode: shape.blendMode,
    effects: structuredClone(shape.effects),
    hidden: shape.hidden,
    locked: shape.locked,
    generator: shape.generator,
    bindings: { ...shape.bindings },
    transform: [...shape.transform],
    transformOrigin: shape.transformOrigin ? { ...shape.transformOrigin } : null,
  };
}
