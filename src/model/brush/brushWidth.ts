import type { BrushShape, Vec2 } from "../types";

// Per-anchor width editing for a committed brush stroke. The node tool grabs a
// knob offset along the centerline's normal; everything here works in the
// shape's local space, in width *multipliers* (`BrushAnchor.w`), so the base
// `strokeWidth` stays the single scale for the whole stroke.

/**
 * Upper bound for an anchor's width multiplier. Files only require `w >= 0`;
 * this is an editing limit so a stray drag can't balloon a stroke.
 */
export const MAX_ANCHOR_WIDTH = 20;

export function clampAnchorWidth(w: number): number {
  return Number.isFinite(w) ? Math.min(MAX_ANCHOR_WIDTH, Math.max(0, w)) : 0;
}

/**
 * Unit normal (left of travel) of the centerline at anchor `index`, matching
 * the convention the envelope uses in `brushOutline.ts`. Falls back to a fixed
 * axis when the tangent is degenerate (a lone or coincident anchor).
 */
export function brushAnchorNormal(shape: BrushShape, index: number): Vec2 {
  const a = shape.anchors[index];
  if (!a) return { x: 0, y: -1 };
  const prev = shape.anchors[index - 1];
  const next = shape.anchors[index + 1];
  // Travel direction across the anchor: its own handles when it has them, the
  // neighbouring anchors otherwise.
  const before = a.hIn ?? prev?.p ?? a.p;
  const after = a.hOut ?? next?.p ?? a.p;
  let dx = after.x - before.x;
  let dy = after.y - before.y;
  let len = Math.hypot(dx, dy);
  if (len < 1e-9 && prev && next) {
    dx = next.p.x - prev.p.x;
    dy = next.p.y - prev.p.y;
    len = Math.hypot(dx, dy);
  }
  if (len < 1e-9) return { x: 0, y: -1 };
  return { x: dy / len, y: -dx / len };
}

/** Half-width of the envelope at anchor `index`, in the shape's local units. */
export function brushAnchorRadius(shape: BrushShape, index: number): number {
  const a = shape.anchors[index];
  return a ? Math.max(0, (shape.strokeWidth * a.w) / 2) : 0;
}

/** Signed distance from anchor `index` to `local` along its normal. */
export function projectOnNormal(
  shape: BrushShape,
  index: number,
  normal: Vec2,
  local: Vec2
): number {
  const a = shape.anchors[index];
  if (!a) return 0;
  return (local.x - a.p.x) * normal.x + (local.y - a.p.y) * normal.y;
}

/**
 * How far the grab point sits beyond the anchor's actual half-width, captured
 * at pointer-down and held for the drag. Without it the width would jump on
 * the first pixel of movement whenever the knob was drawn past its true
 * position (`WIDTH_KNOB_MIN_PX`) or grabbed slightly off-center.
 */
export function widthGrabOffset(
  shape: BrushShape,
  index: number,
  normal: Vec2,
  local: Vec2
): number {
  return (
    Math.abs(projectOnNormal(shape, index, normal, local)) -
    brushAnchorRadius(shape, index)
  );
}

/**
 * The width multiplier a knob dragged to `local` implies for anchor `index`:
 * the distance from the anchor along its normal (less the grab offset), back
 * out of `strokeWidth`. Sign is dropped, so dragging past the centerline
 * mirrors rather than inverting the stroke.
 */
export function widthFromDrag(
  shape: BrushShape,
  index: number,
  normal: Vec2,
  local: Vec2,
  grabOffset = 0
): number {
  if (!shape.anchors[index]) return 0;
  const reach = Math.abs(projectOnNormal(shape, index, normal, local));
  return clampAnchorWidth(
    (2 * Math.max(0, reach - grabOffset)) / Math.max(1e-6, shape.strokeWidth)
  );
}

/** Replace the width of each anchor in `indices` via `next`. */
export function setBrushAnchorWidths(
  shape: BrushShape,
  indices: Iterable<number>,
  next: (w: number, index: number) => number
): BrushShape {
  const targets = new Set(indices);
  if (targets.size === 0) return shape;
  let changed = false;
  const anchors = shape.anchors.map((a, i) => {
    if (!targets.has(i)) return a;
    const w = clampAnchorWidth(next(a.w, i));
    if (w === a.w) return a;
    changed = true;
    return { ...a, w };
  });
  return changed ? { ...shape, anchors } : shape;
}

/**
 * Scale several anchors' widths by one factor. Ratio rather than absolute
 * assignment, so a multi-anchor edit keeps the stroke's taper shape.
 */
export function scaleBrushAnchorWidths(
  shape: BrushShape,
  indices: Iterable<number>,
  factor: number
): BrushShape {
  return setBrushAnchorWidths(shape, indices, (w) => w * factor);
}
