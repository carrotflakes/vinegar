import { ellipseSubpath } from "./ellipse";
import { roundedRectSubpath } from "./roundedRect";
import { strokeDetailFields } from "./stroke";
import type {
  EllipseShape,
  LineShape,
  PathShape,
  PathSubpath,
  RectShape,
  SceneNode,
} from "./types";

export type PathConvertibleShape = RectShape | EllipseShape | LineShape;

export function canConvertShapeToPath(
  node: SceneNode | undefined
): node is PathConvertibleShape {
  return node?.type === "rect" || node?.type === "ellipse" || node?.type === "line";
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

/** Convert live primitive geometry to an editable path without changing appearance. */
export function convertShapeToPath(shape: PathConvertibleShape): PathShape {
  const subpath = shape.type === "rect"
    ? roundedRectSubpath(shape)
    : shape.type === "ellipse"
      ? ellipseSubpath(shape)
      : lineSubpath(shape);
  return {
    id: shape.id,
    name: shape.name,
    type: "path",
    subpaths: [subpath],
    fill: shape.fill,
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    ...strokeDetailFields(shape),
    opacity: shape.opacity,
    blendMode: shape.blendMode,
    effects: shape.effects ? structuredClone(shape.effects) : undefined,
    hidden: shape.hidden,
    locked: shape.locked,
    transform: [...shape.transform],
    transformOrigin: shape.transformOrigin ? { ...shape.transformOrigin } : null,
  };
}
