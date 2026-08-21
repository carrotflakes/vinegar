import { distance, lerp, normalize, samePoint, sub } from "@/model/geometry/vec";
import type { Vec2 } from "../types";
import type { CubicSegment } from "./path";

// ===========================================================================
// Measuring and cutting one cubic segment. Everything here is pure segment
// math — no scene, no subpath — so `path.ts` can build on it without a cycle.
// Contour-level walking (flatten, then step by arc length) lives with its
// callers, which need `path.ts` itself.
// ===========================================================================

/** Samples per curved segment when measuring arc length. */
const LENGTH_SAMPLES = 32;

/** Whether the segment is straight, i.e. both handles sit on their anchors. */
export const isLineSegment = (seg: CubicSegment): boolean =>
  samePoint(seg.c1, seg.p0) && samePoint(seg.c2, seg.p1);

/** Direction of travel leaving `p0`, falling back through the control points. */
export function startTangent(seg: CubicSegment): Vec2 | null {
  return normalize(sub(seg.c1, seg.p0)) ?? normalize(sub(seg.c2, seg.p0)) ??
    normalize(sub(seg.p1, seg.p0));
}

/** Direction of travel arriving at `p1`. */
export function endTangent(seg: CubicSegment): Vec2 | null {
  return normalize(sub(seg.p1, seg.c2)) ?? normalize(sub(seg.p1, seg.c1)) ??
    normalize(sub(seg.p1, seg.p0));
}

/** de Casteljau split at `t`; the two halves share the split point. */
export function splitCubic(
  seg: CubicSegment,
  t: number
): [CubicSegment, CubicSegment] {
  const a = lerp(seg.p0, seg.c1, t);
  const b = lerp(seg.c1, seg.c2, t);
  const c = lerp(seg.c2, seg.p1, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const point = lerp(d, e, t);
  return [
    { p0: seg.p0, c1: a, c2: d, p1: point },
    { p0: point, c1: e, c2: c, p1: seg.p1 },
  ];
}

/** Cumulative arc length at each of `LENGTH_SAMPLES` + 1 sample points. */
function lengthTable(seg: CubicSegment): number[] {
  const table = [0];
  let previous = seg.p0;
  for (let i = 1; i <= LENGTH_SAMPLES; i++) {
    const point = cubicAt(seg, i / LENGTH_SAMPLES);
    table.push(table[i - 1] + distance(previous, point));
    previous = point;
  }
  return table;
}

/** Point on the cubic at parameter `t`. */
function cubicAt(seg: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * seg.p0.x + b * seg.c1.x + c * seg.c2.x + d * seg.p1.x,
    y: a * seg.p0.y + b * seg.c1.y + c * seg.c2.y + d * seg.p1.y,
  };
}

/** Arc length of one segment, sampled for curves and exact for lines. */
export function segmentLength(seg: CubicSegment): number {
  if (isLineSegment(seg)) return distance(seg.p0, seg.p1);
  const table = lengthTable(seg);
  return table[table.length - 1];
}

/** The parameter at arc length `target`, by inverting the sample table. */
export function tAtLength(seg: CubicSegment, target: number): number {
  if (segmentLength(seg) <= 0) return 0;
  const table = lengthTable(seg);
  for (let i = 1; i < table.length; i++) {
    if (table[i] < target) continue;
    const span = table[i] - table[i - 1];
    const local = span > 0 ? (target - table[i - 1]) / span : 0;
    return (i - 1 + local) / LENGTH_SAMPLES;
  }
  return 1;
}

/**
 * Drop `fromStart` / `fromEnd` of arc length from a segment's ends.
 *
 * A straight segment is stored as a cubic whose handles sit on the endpoints,
 * and that cubic is *not* linear in `t` — walking it with de Casteljau would
 * trim the wrong distance and leave handles behind on a straight edge. Move
 * the endpoints along the direction instead.
 */
export function trimSegment(
  seg: CubicSegment,
  fromStart: number,
  fromEnd: number
): CubicSegment {
  if (isLineSegment(seg)) {
    const direction = normalize(sub(seg.p1, seg.p0));
    if (!direction) return seg;
    const p0 = {
      x: seg.p0.x + direction.x * fromStart,
      y: seg.p0.y + direction.y * fromStart,
    };
    const p1 = {
      x: seg.p1.x - direction.x * fromEnd,
      y: seg.p1.y - direction.y * fromEnd,
    };
    return { p0, c1: p0, c2: p1, p1 };
  }
  let result = seg;
  if (fromStart > 0) result = splitCubic(result, tAtLength(result, fromStart))[1];
  if (fromEnd > 0) {
    const remaining = segmentLength(result);
    result = splitCubic(result, tAtLength(result, Math.max(0, remaining - fromEnd)))[0];
  }
  return result;
}
