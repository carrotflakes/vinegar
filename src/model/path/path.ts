import { applyMatrix } from "@/model/geometry/matrix";
import { lerp } from "@/model/geometry/vec";
import type { Matrix, PathAnchor, PathShape, PathSubpath, Vec2 } from "../types";
import { setAnchorType } from "./anchorType";
import { resolvedSubpaths } from "./pathModifiers";

export interface CubicSegment {
  p0: Vec2;
  c1: Vec2;
  c2: Vec2;
  p1: Vec2;
}

/** Convert polygon rings into closed, straight-edged editable subpaths. */
export function ringsToSubpaths(rings: Vec2[][]): PathSubpath[] {
  return rings.map((ring) => ({
    anchors: ring.map((p) => ({ p, hIn: null, hOut: null })),
    closed: true,
  }));
}

/** Bake a matrix into an anchor's point and both handles. */
export function transformAnchor(m: Matrix, a: PathAnchor): PathAnchor {
  return {
    ...a,
    p: applyMatrix(m, a.p),
    hIn: a.hIn ? applyMatrix(m, a.hIn) : null,
    hOut: a.hOut ? applyMatrix(m, a.hOut) : null,
  };
}

/** Bake a matrix into a whole contour, keeping its open/closed state. */
export function transformSubpath(m: Matrix, sp: PathSubpath): PathSubpath {
  return { closed: sp.closed, anchors: sp.anchors.map((a) => transformAnchor(m, a)) };
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
 * The cubic segments making up one subpath. Missing handles collapse to the
 * anchor point, which turns that segment into a straight line.
 */
export function subpathSegments(sp: PathSubpath): CubicSegment[] {
  const a = sp.anchors;
  if (a.length < 2) return [];
  const segs: CubicSegment[] = [];
  const count = sp.closed ? a.length : a.length - 1;
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

/** Flatten one subpath into a polyline for hit-testing and bounds. */
export function flattenSubpath(sp: PathSubpath, perSegment = 18): Vec2[] {
  const segs = subpathSegments(sp);
  if (segs.length === 0) return sp.anchors.map((an) => an.p);
  const pts: Vec2[] = [segs[0].p0];
  for (const seg of segs) {
    if (
      seg.c1.x === seg.p0.x &&
      seg.c1.y === seg.p0.y &&
      seg.c2.x === seg.p1.x &&
      seg.c2.y === seg.p1.y
    ) {
      pts.push(seg.p1);
      continue;
    }
    for (let i = 1; i <= perSegment; i++) {
      pts.push(cubicPoint(seg, i / perSegment));
    }
  }
  return pts;
}

function distanceToLine(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) /
    length;
}

function splitCubicHalf(segment: CubicSegment): [CubicSegment, CubicSegment] {
  const p01 = lerp(segment.p0, segment.c1, 0.5);
  const p12 = lerp(segment.c1, segment.c2, 0.5);
  const p23 = lerp(segment.c2, segment.p1, 0.5);
  const p012 = lerp(p01, p12, 0.5);
  const p123 = lerp(p12, p23, 0.5);
  const midpoint = lerp(p012, p123, 0.5);
  return [
    { p0: segment.p0, c1: p01, c2: p012, p1: midpoint },
    { p0: midpoint, c1: p123, c2: p23, p1: segment.p1 },
  ];
}

/**
 * Flatten a path with a geometric error target instead of a fixed number of
 * samples. Long or sharply curved cubics receive more points while straight
 * and nearly-flat segments stay cheap. The tolerance is in path-local units.
 */
export function flattenSubpathAdaptive(
  subpath: PathSubpath,
  tolerance = 0.1
): Vec2[] {
  const segments = subpathSegments(subpath);
  if (!segments.length) return subpath.anchors.map((anchor) => anchor.p);
  const points: Vec2[] = [segments[0].p0];
  const limit = Math.max(0.001, tolerance);
  const maxDepth = 12;
  const append = (segment: CubicSegment, depth: number) => {
    const flatness = Math.max(
      distanceToLine(segment.c1, segment.p0, segment.p1),
      distanceToLine(segment.c2, segment.p0, segment.p1)
    );
    if (flatness <= limit || depth >= maxDepth) {
      points.push(segment.p1);
      return;
    }
    const [left, right] = splitCubicHalf(segment);
    append(left, depth + 1);
    append(right, depth + 1);
  };
  for (const segment of segments) append(segment, 0);
  return points;
}

/** Every defining point across a set of subpaths (flattened). */
export function flattenSubpaths(
  subpaths: PathSubpath[],
  perSegment = 18
): Vec2[] {
  return subpaths.flatMap((sp) => flattenSubpath(sp, perSegment));
}

/** Every defining point of a path shape, across all subpaths (flattened). */
export function flattenPath(shape: PathShape, perSegment = 18): Vec2[] {
  return flattenSubpaths(resolvedSubpaths(shape), perSegment);
}

export interface PathLocation {
  /** Index into `shape.subpaths`. */
  sub: number;
  /** Index into `subpathSegments(subpath)`; segment i runs anchor i → i+1. */
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
export function closestPointOnPath(
  shape: PathShape,
  p: Vec2
): PathLocation | null {
  let best: PathLocation | null = null;
  const COARSE = 20;
  for (let sub = 0; sub < shape.subpaths.length; sub++) {
    const segs = subpathSegments(shape.subpaths[sub]);
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
        best = { sub, segIndex: si, t, point, distance };
      }
    }
  }
  return best;
}

/**
 * Insert an anchor at parameter `t` of segment `segIndex` of subpath `sub`
 * without changing the curve (de Casteljau subdivision). Straight segments
 * (no handles on either side) get a plain corner anchor so they stay straight.
 */
export function insertAnchorOnSegment(
  shape: PathShape,
  sub: number,
  segIndex: number,
  t: number
): PathShape {
  const sp = shape.subpaths[sub];
  if (!sp) return shape;
  const n = sp.anchors.length;
  const cur = sp.anchors[segIndex];
  const next = sp.anchors[(segIndex + 1) % n];
  if (!cur || !next) return shape;

  const anchors = sp.anchors.slice();
  if (!cur.hOut && !next.hIn) {
    anchors.splice(segIndex + 1, 0, {
      p: lerp(cur.p, next.p, t),
      hIn: null,
      hOut: null,
    });
    return withSubpath(shape, sub, { ...sp, anchors });
  }

  const c1 = cur.hOut ?? cur.p;
  const c2 = next.hIn ?? next.p;
  const q0 = lerp(cur.p, c1, t);
  const q1 = lerp(c1, c2, t);
  const q2 = lerp(c2, next.p, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const s = lerp(r0, r1, t);

  anchors[segIndex] = {
    ...cur,
    hOut: q0,
    ...(cur.t === "symmetric" ? { t: "smooth" as const } : {}),
  };
  anchors[(segIndex + 1) % n] = {
    ...next,
    hIn: q2,
    ...(next.t === "symmetric" ? { t: "smooth" as const } : {}),
  };
  anchors.splice(segIndex + 1, 0, { p: s, hIn: r0, hOut: r1 });
  return withSubpath(shape, sub, { ...sp, anchors });
}

/**
 * Replace one subpath immutably. Directly editing a subpath's anchors/handles
 * overrides any parametric geometry, so the generator link is dropped here —
 * the single funnel for anchor/handle moves, inserts and smoothing toggles.
 */
export function withSubpath(
  shape: PathShape,
  sub: number,
  next: PathSubpath
): PathShape {
  const subpaths = shape.subpaths.slice();
  subpaths[sub] = next;
  return { ...shape, subpaths, generator: null };
}

function reverseSubpath(sp: PathSubpath): PathSubpath {
  const anchors = sp.anchors
    .slice()
    .reverse()
    .map((a) => ({ ...a, hIn: a.hOut, hOut: a.hIn }));
  return { ...sp, anchors };
}

/** Reverse the direction of every subpath (in/out handles swap roles). */
export function reversePath(shape: PathShape): PathShape {
  return { ...shape, subpaths: shape.subpaths.map(reverseSubpath) };
}

/**
 * Toggle an anchor between a sharp corner (no handles) and a smooth point.
 * Smoothing derives handles from the neighbouring anchors (Catmull-Rom
 * style); endpoints of an open path get a single handle toward their only
 * neighbour.
 */
export function toggleAnchorSmooth(
  shape: PathShape,
  sub: number,
  index: number
): PathShape {
  const sp = shape.subpaths[sub];
  if (!sp) return shape;
  const n = sp.anchors.length;
  const a = sp.anchors[index];
  if (!a) return shape;
  const anchors = sp.anchors.slice();

  if (a.hIn || a.hOut) {
    anchors[index] = setAnchorType(
      { ...a, hIn: null, hOut: null },
      "cusp"
    );
    return withSubpath(shape, sub, { ...sp, anchors });
  }

  const prev =
    index > 0 ? sp.anchors[index - 1] : sp.closed ? sp.anchors[n - 1] : null;
  const next =
    index < n - 1 ? sp.anchors[index + 1] : sp.closed ? sp.anchors[0] : null;

  anchors[index] = setAnchorType(a, "smooth", prev, next);
  return withSubpath(shape, sub, { ...sp, anchors });
}
