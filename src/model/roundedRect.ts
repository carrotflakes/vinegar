import { flattenSubpath } from "./bezier";
import { shapeBounds } from "./bounds";
import type { BezierSubpath, RectShape, Vec2 } from "./types";

/** Maximum circular radius that fits inside the rectangle. */
export function maxRectCornerRadius(shape: RectShape): number {
  const bounds = shapeBounds(shape);
  return Math.max(0, Math.min(bounds.width, bounds.height) / 2);
}

/** Persisted radius normalized to the circular radius that can be rendered. */
export function effectiveRectCornerRadius(shape: RectShape): number {
  const requested = Number.isFinite(shape.cornerRadius)
    ? Math.max(0, shape.cornerRadius ?? 0)
    : 0;
  return Math.min(requested, maxRectCornerRadius(shape));
}

/** Clamp an editor-supplied radius to the rectangle's valid authored range. */
export function clampRectCornerRadius(shape: RectShape, radius: number): number {
  return Math.min(Math.max(0, radius), maxRectCornerRadius(shape));
}

/**
 * Closed cubic contour for a rounded rectangle. Eight anchors retain straight
 * edges between four quarter-circle cubic curves, so compound geometry,
 * booleans, hit testing and outline conversion can share one representation.
 */
export function roundedRectSubpath(shape: RectShape): BezierSubpath {
  const b = shapeBounds(shape);
  const r = effectiveRectCornerRadius(shape);
  if (r <= 0) {
    return {
      closed: true,
      anchors: [
        { p: { x: b.x, y: b.y }, hIn: null, hOut: null },
        { p: { x: b.x + b.width, y: b.y }, hIn: null, hOut: null },
        { p: { x: b.x + b.width, y: b.y + b.height }, hIn: null, hOut: null },
        { p: { x: b.x, y: b.y + b.height }, hIn: null, hOut: null },
      ],
    };
  }

  const right = b.x + b.width;
  const bottom = b.y + b.height;
  const handle = r * 0.5522847498307936;
  return {
    closed: true,
    anchors: [
      {
        p: { x: b.x + r, y: b.y },
        hIn: { x: b.x + r - handle, y: b.y },
        hOut: null,
      },
      {
        p: { x: right - r, y: b.y },
        hIn: null,
        hOut: { x: right - r + handle, y: b.y },
      },
      {
        p: { x: right, y: b.y + r },
        hIn: { x: right, y: b.y + r - handle },
        hOut: null,
      },
      {
        p: { x: right, y: bottom - r },
        hIn: null,
        hOut: { x: right, y: bottom - r + handle },
      },
      {
        p: { x: right - r, y: bottom },
        hIn: { x: right - r + handle, y: bottom },
        hOut: null,
      },
      {
        p: { x: b.x + r, y: bottom },
        hIn: null,
        hOut: { x: b.x + r - handle, y: bottom },
      },
      {
        p: { x: b.x, y: bottom - r },
        hIn: { x: b.x, y: bottom - r + handle },
        hOut: null,
      },
      {
        p: { x: b.x, y: b.y + r },
        hIn: null,
        hOut: { x: b.x, y: b.y + r - handle },
      },
    ],
  };
}

/** Flattened shared contour for distance tests and polygon offsetting. */
export function roundedRectPolyline(shape: RectShape): Vec2[] {
  if (effectiveRectCornerRadius(shape) <= 0) {
    return roundedRectSubpath(shape).anchors.map((anchor) => anchor.p);
  }
  const points = flattenSubpath(roundedRectSubpath(shape), 8);
  // Closed Bézier flattening repeats the starting point at the end; polygon
  // consumers already close the ring and prefer unique vertices.
  return points.slice(0, -1);
}

/** Exact fill containment for the circular-corner rectangle. */
export function pointInRoundedRect(shape: RectShape, point: Vec2): boolean {
  const b = shapeBounds(shape);
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  if (point.x < b.x || point.x > right || point.y < b.y || point.y > bottom) {
    return false;
  }
  const r = effectiveRectCornerRadius(shape);
  if (r <= 0) return true;
  if (
    (point.x >= b.x + r && point.x <= right - r) ||
    (point.y >= b.y + r && point.y <= bottom - r)
  ) {
    return true;
  }
  const cx = point.x < b.x + r ? b.x + r : right - r;
  const cy = point.y < b.y + r ? b.y + r : bottom - r;
  return Math.hypot(point.x - cx, point.y - cy) <= r;
}
