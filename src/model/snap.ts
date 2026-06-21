import { unionWorldBounds, worldShapeBounds } from "./bounds";
import type { Bounds, Shape } from "./types";

/** A line other shapes can snap to, with the perpendicular extent of its source. */
interface Candidate {
  value: number;
  lo: number;
  hi: number;
}

export interface SnapTargets {
  x: Candidate[];
  y: Candidate[];
}

/** An alignment guide to draw (world coordinates). */
export interface Guide {
  axis: "x" | "y";
  value: number;
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

function boxCandidates(b: Bounds): { x: Candidate[]; y: Candidate[] } {
  const yExt = { lo: b.y, hi: b.y + b.height };
  const xExt = { lo: b.x, hi: b.x + b.width };
  return {
    x: [
      { value: b.x, ...yExt },
      { value: b.x + b.width / 2, ...yExt },
      { value: b.x + b.width, ...yExt },
    ],
    y: [
      { value: b.y, ...xExt },
      { value: b.y + b.height / 2, ...xExt },
      { value: b.y + b.height, ...xExt },
    ],
  };
}

/** Collect snap lines (left/center/right, top/middle/bottom) from `shapes`. */
export function collectSnapTargets(shapes: Shape[]): SnapTargets {
  const x: Candidate[] = [];
  const y: Candidate[] = [];
  for (const s of shapes) {
    const c = boxCandidates(worldShapeBounds(s));
    x.push(...c.x);
    y.push(...c.y);
  }
  return { x, y };
}

function snapAxis(
  edges: number[],
  perp: [number, number],
  cands: Candidate[],
  threshold: number
): { offset: number; value: number; lo: number; hi: number } | null {
  let best: { ad: number; offset: number; value: number } | null = null;
  for (const e of edges) {
    for (const c of cands) {
      const d = c.value - e;
      const ad = Math.abs(d);
      if (ad <= threshold && (best === null || ad < best.ad)) {
        best = { ad, offset: d, value: c.value };
      }
    }
  }
  if (!best) return null;
  let lo = perp[0];
  let hi = perp[1];
  for (const c of cands) {
    if (Math.abs(c.value - best.value) < 0.5) {
      lo = Math.min(lo, c.lo);
      hi = Math.max(hi, c.hi);
    }
  }
  return { offset: best.offset, value: best.value, lo, hi };
}

/**
 * Snap a moving AABB to alignment targets. Returns the extra offset needed to
 * align (added on top of the raw move) plus the guides to draw.
 */
export function computeSnap(
  box: Bounds,
  targets: SnapTargets,
  threshold: number
): SnapResult {
  const xEdges = [box.x, box.x + box.width / 2, box.x + box.width];
  const yEdges = [box.y, box.y + box.height / 2, box.y + box.height];
  const sx = snapAxis(xEdges, [box.y, box.y + box.height], targets.x, threshold);
  const sy = snapAxis(yEdges, [box.x, box.x + box.width], targets.y, threshold);

  const guides: Guide[] = [];
  if (sx) guides.push({ axis: "x", value: sx.value, from: sx.lo, to: sx.hi });
  if (sy) guides.push({ axis: "y", value: sy.value, from: sy.lo, to: sy.hi });
  return { dx: sx?.offset ?? 0, dy: sy?.offset ?? 0, guides };
}

export { unionWorldBounds };
