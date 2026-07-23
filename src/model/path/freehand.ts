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
 * Convert a polyline into smooth Bézier anchors using a Catmull-Rom tangent
 * (handles = ±(next − prev) / 6). The result is editable with the node tool.
 */
export function pointsToAnchors(points: Vec2[], closed: boolean): PathAnchor[] {
  const n = points.length;
  const anchors: PathAnchor[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[i - 1] ?? (closed ? points[n - 1] : p);
    const next = points[i + 1] ?? (closed ? points[0] : p);
    const tx = (next.x - prev.x) / 6;
    const ty = (next.y - prev.y) / 6;
    anchors.push({
      p,
      hIn: { x: p.x - tx, y: p.y - ty },
      hOut: { x: p.x + tx, y: p.y + ty },
    });
  }
  return anchors;
}
