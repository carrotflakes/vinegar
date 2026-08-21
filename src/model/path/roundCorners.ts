import type { PathAnchor, PathSubpath, Vec2 } from "../types";
import { subpathSegments, type CubicSegment } from "./path";

/** Samples per curved segment when measuring arc length. */
const LENGTH_SAMPLES = 32;
/** Corners flatter than this (in radians) are left alone. */
const MIN_TURN = 1e-3;
/** A corner may eat at most this share of each neighbouring segment. */
const BUDGET = 0.999;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (v: Vec2, k: number): Vec2 => ({ x: v.x * k, y: v.y * k });
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const same = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

function unit(v: Vec2): Vec2 | null {
  const length = Math.hypot(v.x, v.y);
  return length > 1e-12 ? { x: v.x / length, y: v.y / length } : null;
}

const isLine = (seg: CubicSegment): boolean =>
  same(seg.c1, seg.p0) && same(seg.c2, seg.p1);

/** Direction of travel leaving `p0`, falling back through the control points. */
function startTangent(seg: CubicSegment): Vec2 | null {
  return unit(sub(seg.c1, seg.p0)) ?? unit(sub(seg.c2, seg.p0)) ??
    unit(sub(seg.p1, seg.p0));
}

/** Direction of travel arriving at `p1`. */
function endTangent(seg: CubicSegment): Vec2 | null {
  return unit(sub(seg.p1, seg.c2)) ?? unit(sub(seg.p1, seg.c1)) ??
    unit(sub(seg.p1, seg.p0));
}

/** Cumulative arc length at each of `LENGTH_SAMPLES` + 1 sample points. */
function lengthTable(seg: CubicSegment): number[] {
  const table = [0];
  let previous = seg.p0;
  for (let i = 1; i <= LENGTH_SAMPLES; i++) {
    const t = i / LENGTH_SAMPLES;
    const u = 1 - t;
    const point = {
      x: u * u * u * seg.p0.x + 3 * u * u * t * seg.c1.x +
        3 * u * t * t * seg.c2.x + t * t * t * seg.p1.x,
      y: u * u * u * seg.p0.y + 3 * u * u * t * seg.c1.y +
        3 * u * t * t * seg.c2.y + t * t * t * seg.p1.y,
    };
    table.push(table[i - 1] + Math.hypot(point.x - previous.x, point.y - previous.y));
    previous = point;
  }
  return table;
}

function segmentLength(seg: CubicSegment): number {
  if (isLine(seg)) return Math.hypot(seg.p1.x - seg.p0.x, seg.p1.y - seg.p0.y);
  const table = lengthTable(seg);
  return table[table.length - 1];
}

/** The parameter at arc length `target`, by inverting the sample table. */
function tAtLength(seg: CubicSegment, target: number): number {
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

/** de Casteljau split at `t`. */
function splitCubic(seg: CubicSegment, t: number): [CubicSegment, CubicSegment] {
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

/** Drop `distance` of arc length from each end of a segment. */
function trim(seg: CubicSegment, fromStart: number, fromEnd: number): CubicSegment {
  if (isLine(seg)) {
    // A straight segment is stored as a cubic whose handles sit on the
    // endpoints, and that cubic is *not* linear in `t` — walking it with
    // de Casteljau would trim the wrong distance and leave handles behind on a
    // straight edge. Move the endpoints along the direction instead.
    const direction = unit(sub(seg.p1, seg.p0));
    if (!direction) return seg;
    const p0 = add(seg.p0, mul(direction, fromStart));
    const p1 = sub(seg.p1, mul(direction, fromEnd));
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

/**
 * The circular fillet joining two tangent points. `u`/`v` are the unit
 * directions of travel at `from`/`to`; the cubic approximates the arc that is
 * tangent to both, which is what keeps the join smooth (G1).
 */
function arcSegment(from: Vec2, to: Vec2, u: Vec2, v: Vec2): CubicSegment {
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  const turn = Math.abs(Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y));
  const radius = turn > MIN_TURN ? chord / (2 * Math.sin(turn / 2)) : 0;
  const handle = (4 / 3) * Math.tan(turn / 4) * radius;
  return {
    p0: from,
    c1: add(from, mul(u, handle)),
    c2: sub(to, mul(v, handle)),
    p1: to,
  };
}

/** Rebuild anchors from a chain of cubic segments. */
function segmentsToSubpath(segs: CubicSegment[], closed: boolean): PathSubpath {
  const anchors: PathAnchor[] = segs.map((seg, index) => {
    const previous = index > 0 ? segs[index - 1] : closed ? segs[segs.length - 1] : null;
    return {
      p: seg.p0,
      hIn: previous && !same(previous.c2, seg.p0) ? previous.c2 : null,
      hOut: same(seg.c1, seg.p0) ? null : seg.c1,
    };
  });
  if (!closed) {
    const last = segs[segs.length - 1];
    anchors.push({
      p: last.p1,
      hIn: same(last.c2, last.p1) ? null : last.c2,
      hOut: null,
    });
  }
  return { closed, anchors };
}

function roundSubpath(subpath: PathSubpath, radius: number): PathSubpath {
  const segs = subpathSegments(subpath);
  if (segs.length < 2 && !(subpath.closed && segs.length)) return subpath;
  const count = segs.length;
  const lengths = segs.map(segmentLength);
  // Corner `i` joins the end of segment `i - 1` to the start of segment `i`.
  // An open contour has no corner at its two loose ends.
  const distances = segs.map((seg, i) => {
    const previous = i === 0 ? (subpath.closed ? segs[count - 1] : null) : segs[i - 1];
    if (!previous) return 0;
    const incoming = endTangent(previous);
    const outgoing = startTangent(seg);
    if (!incoming || !outgoing) return 0;
    const turn = Math.abs(Math.atan2(
      incoming.x * outgoing.y - incoming.y * outgoing.x,
      incoming.x * outgoing.x + incoming.y * outgoing.y
    ));
    if (turn < MIN_TURN) return 0;
    // Fillet geometry: a radius-r arc meets the corner's legs this far out.
    return radius * Math.tan(turn / 2);
  });
  // A leg is shared by the corners at both of its ends, so it caps how much
  // either may take; over-subscribed corners shrink together.
  const scales = segs.map((_, i) => {
    const wanted = distances[i] + distances[(i + 1) % count];
    const room = lengths[i] * BUDGET;
    return wanted > room && wanted > 0 ? room / wanted : 1;
  });
  const capped = distances.map((distance, i) => {
    const before = subpath.closed || i > 0 ? scales[(i - 1 + count) % count] : 1;
    return distance * Math.min(before, scales[i]);
  });
  if (!capped.some((distance) => distance > 0)) return subpath;

  const trimmed = segs.map((seg, i) => {
    const next = (i + 1) % count;
    const fromEnd = subpath.closed || next > 0 ? capped[next] : 0;
    return trim(seg, capped[i], fromEnd);
  });
  const out: CubicSegment[] = [];
  trimmed.forEach((seg, i) => {
    out.push(seg);
    const next = (i + 1) % count;
    if (!subpath.closed && next === 0) return;
    if (capped[next] <= 0) return;
    const u = endTangent(seg);
    const v = startTangent(trimmed[next]);
    if (!u || !v) return;
    out.push(arcSegment(seg.p1, trimmed[next].p0, u, v));
  });
  return segmentsToSubpath(out, subpath.closed);
}

/**
 * Round every corner of every contour with a circular fillet of `radius`,
 * the path-wide generalization of a rect's corner radius. Smooth joins and
 * loose endpoints are left alone; a corner whose legs are too short for the
 * full radius rounds as much as the legs allow.
 */
export function roundSubpaths(
  subpaths: PathSubpath[],
  radius: number
): PathSubpath[] {
  if (!(radius > 0)) return subpaths;
  return subpaths.map((subpath) => roundSubpath(subpath, radius));
}
