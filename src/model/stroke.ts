import type {
  Shape,
  ShapePaintFields,
  StrokeAlignment,
  StrokeCap,
  StrokeJoin,
} from "./types";
import { markerOutset } from "./marker";
import { isClosedGeometry } from "./path/shapeGeometry";

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
export function supportsStrokeAlignment(shape: Shape): boolean {
  return isClosedGeometry(shape);
}

export function effectiveStrokeAlignment(shape: Shape): StrokeAlignment {
  return supportsStrokeAlignment(shape) ? shape.strokeAlignment : "center";
}

/**
 * Maximum local-space stroke protrusion beyond the geometry bounds. Miter
 * joins receive a deliberately conservative multiplier so exports do not crop
 * sharp corners.
 */
export function strokeOutset(shape: Shape): number {
  // Brush strokes bake their width into the envelope geometry, so bounds are
  // already outset; a second stroke reach would double-count.
  if (shape.type === "brush") return 0;
  if (!shape.stroke || shape.strokeWidth <= 0) return 0;
  const alignment = effectiveStrokeAlignment(shape);
  let outset = alignment === "inside"
    ? 0
    : alignment === "outside"
      ? shape.strokeWidth
      : shape.strokeWidth / 2;
  if (outset > 0 && shape.strokeJoin === "miter") outset *= STROKE_MITER_LIMIT;
  // End markers paint outside the geometry too, and reach further than the pen.
  return Math.max(outset, markerOutset(shape));
}

/**
 * Copy a shape's whole paint/stroke appearance onto a newly-created result.
 *
 * Paints are carried by reference, as the hand-written field lists this
 * replaced did — a `Paint` is treated as immutable everywhere. A conversion
 * that means to change one paint spreads this and then overrides that field,
 * so the change reads as the deliberate exception it is.
 */
export function shapePaintFields(shape: ShapePaintFields): ShapePaintFields {
  return {
    fill: shape.fill,
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    strokeDash: normalizeStrokeDash(shape.strokeDash),
    strokeDashOffset: shape.strokeDashOffset,
    strokeCap: shape.strokeCap,
    strokeJoin: shape.strokeJoin,
    strokeAlignment: shape.strokeAlignment,
  };
}
