import { flattenBezier } from "./bezier";
import { shapeBounds, shapeCenter } from "./bounds";
import { rotateAbout } from "./rotate";
import type { Shape, Vec2 } from "./types";

/** Even-odd point-in-polygon test. */
function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from p to the nearest segment of a polyline (optionally closed). */
function distToPolyline(p: Vec2, pts: Vec2[], closed: boolean): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  }
  if (closed && pts.length > 2) {
    best = Math.min(best, distToSegment(p, pts[pts.length - 1], pts[0]));
  }
  return best;
}

/** Distance from point p to the segment a-b. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Whether world-point `p` hits the given shape.
 * `tol` is an extra tolerance in world units (scaled for stroke pickability).
 */
export function hitTestShape(shape: Shape, p: Vec2, tol: number): boolean {
  const hasFill = shape.fill !== null;
  const pickTol = Math.max(tol, shape.stroke ? shape.strokeWidth / 2 + tol : tol);

  // Work in the shape's unrotated local frame by inverse-rotating the point.
  if (shape.rotation) {
    p = rotateAbout(shapeCenter(shape), p, -shape.rotation);
  }

  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      if (hasFill) {
        return (
          p.x >= b.x - tol &&
          p.x <= b.x + b.width + tol &&
          p.y >= b.y - tol &&
          p.y <= b.y + b.height + tol
        );
      }
      // outline only: near any of the four edges
      const corners: Vec2[] = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
        { x: b.x, y: b.y + b.height },
      ];
      for (let i = 0; i < 4; i++) {
        if (distToSegment(p, corners[i], corners[(i + 1) % 4]) <= pickTol)
          return true;
      }
      return false;
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rx = b.width / 2;
      const ry = b.height / 2;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (p.x - cx) / rx;
      const ny = (p.y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (hasFill) {
        return d <= 1 + pickTol / Math.max(rx, ry);
      }
      // ring test: close to the unit circle in normalized space
      const ring = pickTol / Math.min(rx, ry);
      return Math.abs(Math.sqrt(d) - 1) <= ring;
    }
    case "line": {
      return (
        distToSegment(
          p,
          { x: shape.x1, y: shape.y1 },
          { x: shape.x2, y: shape.y2 }
        ) <= pickTol
      );
    }
    case "path": {
      if (hasFill && shape.closed && pointInPolygon(p, shape.points))
        return true;
      return distToPolyline(p, shape.points, shape.closed) <= pickTol;
    }
    case "bezier": {
      const flat = flattenBezier(shape);
      if (hasFill && shape.closed && pointInPolygon(p, flat)) return true;
      return distToPolyline(p, flat, shape.closed) <= pickTol;
    }
  }
}
