import type {
  BaseShape,
  Document,
  Shape,
  StrokeAlignment,
  StrokeCap,
  StrokeJoin,
} from "./types";
import { resolvedSubpaths } from "./path/pathModifiers";

export const DEFAULT_STROKE_CAP: StrokeCap = "round";
export const DEFAULT_STROKE_JOIN: StrokeJoin = "round";
export const DEFAULT_STROKE_ALIGNMENT: StrokeAlignment = "center";
export const STROKE_MITER_LIMIT = 4;

/** Remove non-rendering all-zero patterns while preserving odd-length arrays. */
export function normalizeStrokeDash(dash: readonly number[]): number[] {
  if (!dash.length || dash.every((value) => value === 0)) return [];
  return [...dash];
}

/** Inside/outside is well-defined only for closed geometry and live text. */
export function supportsStrokeAlignment(shape: Shape, doc?: Document): boolean {
  switch (shape.type) {
    case "rect":
    case "ellipse":
    case "compoundPath":
    case "text":
      return true;
    case "path":
      const subpaths = resolvedSubpaths(shape, doc);
      return subpaths.length > 0 && subpaths.every((subpath) => subpath.closed);
    case "line":
    case "image":
    case "brush":
      return false;
  }
}

export function effectiveStrokeAlignment(
  shape: Shape,
  doc?: Document
): StrokeAlignment {
  return supportsStrokeAlignment(shape, doc) ? shape.strokeAlignment : "center";
}

/**
 * Maximum local-space stroke protrusion beyond the geometry bounds. Miter
 * joins receive a deliberately conservative multiplier so exports do not crop
 * sharp corners.
 */
export function strokeOutset(shape: Shape, doc?: Document): number {
  // Brush strokes bake their width into the envelope geometry, so bounds are
  // already outset; a second stroke reach would double-count.
  if (shape.type === "brush") return 0;
  if (!shape.stroke || shape.strokeWidth <= 0) return 0;
  const alignment = effectiveStrokeAlignment(shape, doc);
  let outset = alignment === "inside"
    ? 0
    : alignment === "outside"
      ? shape.strokeWidth
      : shape.strokeWidth / 2;
  if (outset > 0 && shape.strokeJoin === "miter") outset *= STROKE_MITER_LIMIT;
  return outset;
}

/** Copy a shape's stroke appearance to a newly-created result. */
export function strokeDetailFields(shape: BaseShape): Pick<
  BaseShape,
  "strokeDash" | "strokeDashOffset" | "strokeCap" | "strokeJoin" | "strokeAlignment"
> {
  return {
    strokeDash: normalizeStrokeDash(shape.strokeDash),
    strokeDashOffset: shape.strokeDashOffset,
    strokeCap: shape.strokeCap,
    strokeJoin: shape.strokeJoin,
    strokeAlignment: shape.strokeAlignment,
  };
}
