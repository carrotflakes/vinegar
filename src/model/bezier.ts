import type { BezierAnchor, BezierShape, Vec2 } from "./types";

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

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export interface BezierLocation {
  /** Index into `bezierSegments(shape)`; segment i runs anchor i → i+1. */
  segIndex: number;
  /** Parameter within the segment, in [0, 1]. */
  t: number;
  point: Vec2;
  distance: number;
}

/**
 * The closest point on the shape's outline to `p`. Coarse sampling per
 * segment followed by a ternary-search refinement — plenty accurate for
 * click targets. Returns null for shapes with no segments.
 */
export function closestPointOnBezier(
  shape: BezierShape,
  p: Vec2
): BezierLocation | null {
  const segs = bezierSegments(shape);
  let best: BezierLocation | null = null;
  const COARSE = 20;
  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si];
    const distAt = (t: number) => {
      const q = cubicPoint(seg, t);
      return Math.hypot(q.x - p.x, q.y - p.y);
    };
    let bt = 0;
    let bd = Infinity;
    for (let i = 0; i <= COARSE; i++) {
      const t = i / COARSE;
      const d = distAt(t);
      if (d < bd) {
        bd = d;
        bt = t;
      }
    }
    let lo = Math.max(0, bt - 1 / COARSE);
    let hi = Math.min(1, bt + 1 / COARSE);
    for (let iter = 0; iter < 24; iter++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (distAt(m1) < distAt(m2)) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    const point = cubicPoint(seg, t);
    const distance = Math.hypot(point.x - p.x, point.y - p.y);
    if (!best || distance < best.distance) {
      best = { segIndex: si, t, point, distance };
    }
  }
  return best;
}

/**
 * Insert an anchor at parameter `t` of segment `segIndex` without changing
 * the curve (de Casteljau subdivision). Straight segments (no handles on
 * either side) get a plain corner anchor so they stay straight lines.
 */
export function insertAnchorOnSegment(
  shape: BezierShape,
  segIndex: number,
  t: number
): BezierShape {
  const n = shape.anchors.length;
  const cur = shape.anchors[segIndex];
  const next = shape.anchors[(segIndex + 1) % n];
  if (!cur || !next) return shape;

  const anchors = shape.anchors.slice();
  if (!cur.hOut && !next.hIn) {
    anchors.splice(segIndex + 1, 0, {
      p: lerp(cur.p, next.p, t),
      hIn: null,
      hOut: null,
    });
    return { ...shape, anchors };
  }

  const c1 = cur.hOut ?? cur.p;
  const c2 = next.hIn ?? next.p;
  const q0 = lerp(cur.p, c1, t);
  const q1 = lerp(c1, c2, t);
  const q2 = lerp(c2, next.p, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const s = lerp(r0, r1, t);

  anchors[segIndex] = { ...cur, hOut: q0 };
  anchors[(segIndex + 1) % n] = { ...next, hIn: q2 };
  anchors.splice(segIndex + 1, 0, { p: s, hIn: r0, hOut: r1 });
  return { ...shape, anchors };
}

/** Reverse the direction of a path (in/out handles swap roles). */
export function reverseBezier(shape: BezierShape): BezierShape {
  const anchors = shape.anchors
    .slice()
    .reverse()
    .map((a) => ({ p: a.p, hIn: a.hOut, hOut: a.hIn }));
  return { ...shape, anchors };
}

/**
 * Toggle an anchor between a sharp corner (no handles) and a smooth point.
 * Smoothing derives handles from the neighbouring anchors (Catmull-Rom
 * style); endpoints of an open path get a single handle toward their only
 * neighbour.
 */
export function toggleAnchorSmooth(
  shape: BezierShape,
  index: number
): BezierShape {
  const n = shape.anchors.length;
  const a = shape.anchors[index];
  if (!a) return shape;
  const anchors = shape.anchors.slice();

  if (a.hIn || a.hOut) {
    anchors[index] = { ...a, hIn: null, hOut: null };
    return { ...shape, anchors };
  }

  const prev =
    index > 0 ? shape.anchors[index - 1] : shape.closed ? shape.anchors[n - 1] : null;
  const next =
    index < n - 1 ? shape.anchors[index + 1] : shape.closed ? shape.anchors[0] : null;

  let smoothed: BezierAnchor = a;
  if (prev && next) {
    const dx = next.p.x - prev.p.x;
    const dy = next.p.y - prev.p.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const inLen = Math.hypot(a.p.x - prev.p.x, a.p.y - prev.p.y) / 3;
    const outLen = Math.hypot(next.p.x - a.p.x, next.p.y - a.p.y) / 3;
    smoothed = {
      ...a,
      hIn: { x: a.p.x - ux * inLen, y: a.p.y - uy * inLen },
      hOut: { x: a.p.x + ux * outLen, y: a.p.y + uy * outLen },
    };
  } else if (next) {
    smoothed = { ...a, hOut: lerp(a.p, next.p, 1 / 3) };
  } else if (prev) {
    smoothed = { ...a, hIn: lerp(a.p, prev.p, 1 / 3) };
  }
  anchors[index] = smoothed;
  return { ...shape, anchors };
}
