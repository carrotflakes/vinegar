import type { PathAnchor, Vec2 } from "../types";

/** Perpendicular distance from point p to the infinite line through a, b. */
function perpDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/**
 * Ramer–Douglas–Peucker polyline simplification. Drops points that lie within
 * `epsilon` of the line between kept neighbours.
 */
export function simplifyPath(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > epsilon && index !== -1) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Catmull-Rom tangent handles for anchor `p` sitting between neighbours `prev`
 * and `next`. The tangent direction is the usual `(next − prev) / 6`, but each
 * handle's length is capped at one third of the chord to *its own* neighbour.
 *
 * For even spacing the cap never bites — `(next − prev) / 6` already equals
 * `chord / 3` — so this is the plain uniform Catmull-Rom. It only kicks in when
 * spacing is lopsided (a far anchor on one side, a near one on the other),
 * where the raw tangent would push a handle *past* the adjacent anchor and the
 * cubic would overshoot and hook back. That hook is normally hidden under a
 * uniform width and a round cap, but a tapered brush tip is thin and exposes
 * it — the "messy endpoint" bug. Clamping keeps the tangent direction (still a
 * smooth anchor) while forbidding the overshoot.
 */
export function catmullRomHandles(
  prev: Vec2,
  p: Vec2,
  next: Vec2
): { hIn: Vec2; hOut: Vec2 } {
  const tx = (next.x - prev.x) / 6;
  const ty = (next.y - prev.y) / 6;
  const tlen = Math.hypot(tx, ty);
  if (tlen < 1e-12) return { hIn: { ...p }, hOut: { ...p } };
  const ux = tx / tlen;
  const uy = ty / tlen;
  const outLen = Math.min(tlen, Math.hypot(next.x - p.x, next.y - p.y) / 3);
  const inLen = Math.min(tlen, Math.hypot(p.x - prev.x, p.y - prev.y) / 3);
  return {
    hIn: { x: p.x - ux * inLen, y: p.y - uy * inLen },
    hOut: { x: p.x + ux * outLen, y: p.y + uy * outLen },
  };
}

/**
 * Convert a polyline into smooth Bézier anchors using a Catmull-Rom tangent
 * (see {@link catmullRomHandles}). The result is editable with the node tool.
 */
export function pointsToAnchors(points: Vec2[], closed: boolean): PathAnchor[] {
  const n = points.length;
  const anchors: PathAnchor[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[i - 1] ?? (closed ? points[n - 1] : p);
    const next = points[i + 1] ?? (closed ? points[0] : p);
    anchors.push({ p, ...catmullRomHandles(prev, p, next) });
  }
  return anchors;
}
