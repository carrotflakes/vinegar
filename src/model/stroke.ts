import type {
  BaseShape,
  Shape,
  StrokeAlignment,
  StrokeCap,
  StrokeJoin,
} from "./types";

export const DEFAULT_STROKE_CAP: StrokeCap = "round";
export const DEFAULT_STROKE_JOIN: StrokeJoin = "round";
export const DEFAULT_STROKE_ALIGNMENT: StrokeAlignment = "center";
export const STROKE_MITER_LIMIT = 4;

/** Remove non-rendering all-zero patterns while preserving odd-length arrays. */
export function normalizeStrokeDash(dash: readonly number[] | undefined): number[] {
  if (!dash?.length || dash.every((value) => value === 0)) return [];
  return [...dash];
}

export function strokeCap(shape: BaseShape): StrokeCap {
  return shape.strokeCap ?? DEFAULT_STROKE_CAP;
}

export function strokeJoin(shape: BaseShape): StrokeJoin {
  return shape.strokeJoin ?? DEFAULT_STROKE_JOIN;
}

export function strokeAlignment(shape: BaseShape): StrokeAlignment {
  return shape.strokeAlignment ?? DEFAULT_STROKE_ALIGNMENT;
}

/** Inside/outside is well-defined only for closed geometry and live text. */
export function supportsStrokeAlignment(shape: Shape): boolean {
  switch (shape.type) {
    case "rect":
    case "ellipse":
    case "compoundPath":
    case "text":
      return true;
    case "path":
      return shape.subpaths.length > 0 && shape.subpaths.every((subpath) => subpath.closed);
    case "line":
    case "image":
    case "brush":
      return false;
  }
}

export function effectiveStrokeAlignment(shape: Shape): StrokeAlignment {
  return supportsStrokeAlignment(shape) ? strokeAlignment(shape) : "center";
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
  if (outset > 0 && strokeJoin(shape) === "miter") outset *= STROKE_MITER_LIMIT;
  return outset;
}

/** Copy a shape's resolved stroke appearance to a newly-created result. */
export function strokeDetailFields(shape: BaseShape): Pick<
  BaseShape,
  "strokeDash" | "strokeDashOffset" | "strokeCap" | "strokeJoin" | "strokeAlignment"
> {
  const dash = normalizeStrokeDash(shape.strokeDash);
  return {
    strokeDash: dash.length ? dash : undefined,
    strokeDashOffset: shape.strokeDashOffset || undefined,
    strokeCap: strokeCap(shape),
    strokeJoin: strokeJoin(shape),
    strokeAlignment: strokeAlignment(shape),
  };
}
