import { compoundChildren } from "./compoundPath";
import { cachedBrushEnvelope } from "@/model/brush/brushOutline";
import { ellipseSubpath } from "../ellipse";
import { applyMatrix } from "@/model/geometry/matrix";
import { roundedRectSubpath } from "../roundedRect";
import { strokeDetailFields } from "../stroke";
import type {
  CompoundPathNode,
  BrushShape,
  Document,
  EllipseShape,
  LineShape,
  Matrix,
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

function primitiveSubpaths(shape: PrimitiveShape): PathSubpath[] {
  switch (shape.type) {
    case "rect":
      return [roundedRectSubpath(shape)];
    case "ellipse":
      return [ellipseSubpath(shape)];
    case "line":
      return [lineSubpath(shape)];
    case "path":
      return shape.subpaths;
  }
}

function transformSubpath(subpath: PathSubpath, matrix: Matrix): PathSubpath {
  return {
    closed: subpath.closed,
    anchors: subpath.anchors.map((anchor) => ({
      p: applyMatrix(matrix, anchor.p),
      hIn: anchor.hIn ? applyMatrix(matrix, anchor.hIn) : null,
      hOut: anchor.hOut ? applyMatrix(matrix, anchor.hOut) : null,
    })),
  };
}

function brushSubpaths(shape: BrushShape): PathSubpath[] {
  const ring = cachedBrushEnvelope(shape);
  if (ring.length < 3) return [];
  return [{
    closed: true,
    anchors: ring.map((p) => ({ p: { ...p }, hIn: null, hOut: null })),
  }];
}

/** Convert supported shape geometry to an editable path without changing appearance. */
export function convertShapeToPath(
  shape: PathConvertibleShape,
  doc: Document
): PathShape {
  const subpaths = shape.type === "compoundPath"
    ? compoundChildren(doc, shape).flatMap((child) =>
        primitiveSubpaths(child).map((subpath) =>
          transformSubpath(subpath, child.transform)
        )
      )
    : shape.type === "brush"
      ? brushSubpaths(shape)
      : primitiveSubpaths(shape);
  const brush = shape.type === "brush";
  return {
    id: shape.id,
    name: shape.name,
    type: "path",
    subpaths,
    fillRule: shape.type === "compoundPath"
      ? "evenodd"
      : brush
        ? "nonzero"
        : undefined,
    fill: brush ? shape.stroke : shape.fill,
    stroke: brush ? null : shape.stroke,
    strokeWidth: brush ? 0 : shape.strokeWidth,
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
