import type { BezierShape, Vec2 } from "./types";

export interface CubicSegment {
  p0: Vec2;
  c1: Vec2;
  c2: Vec2;
  p1: Vec2;
}

/** Point on a cubic Bézier at parameter t in [0, 1]. */
export function cubicPoint(s: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p1.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p1.y,
  };
}

/**
 * The cubic segments making up a Bézier shape. Missing handles collapse to the
 * anchor point, which turns that segment into a straight line.
 */
export function bezierSegments(shape: BezierShape): CubicSegment[] {
  const a = shape.anchors;
  if (a.length < 2) return [];
  const segs: CubicSegment[] = [];
  const count = shape.closed ? a.length : a.length - 1;
  for (let i = 0; i < count; i++) {
    const cur = a[i];
    const next = a[(i + 1) % a.length];
    segs.push({
      p0: cur.p,
      c1: cur.hOut ?? cur.p,
      c2: next.hIn ?? next.p,
      p1: next.p,
    });
  }
  return segs;
}

/** Flatten a Bézier shape into a polyline for hit-testing and bounds. */
export function flattenBezier(shape: BezierShape, perSegment = 18): Vec2[] {
  const segs = bezierSegments(shape);
  if (segs.length === 0) return shape.anchors.map((an) => an.p);
  const pts: Vec2[] = [segs[0].p0];
  for (const seg of segs) {
    for (let i = 1; i <= perSegment; i++) {
      pts.push(cubicPoint(seg, i / perSegment));
    }
  }
  return pts;
}
