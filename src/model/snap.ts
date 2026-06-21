import { worldShapeBounds } from "./bounds";
import type { Bounds, Shape, Vec2 } from "./types";

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

/** An equal-spacing marker bar (world coordinates). */
export interface Spacing {
  horizontal: boolean;
  a: number;
  b: number;
  pos: number;
}

export interface SnapContext {
  targets: SnapTargets;
  /** Other shapes' world AABBs, used for distribution (equal spacing). */
  boxes: Bounds[];
  /** Grid size in world units, or null to disable grid snapping. */
  gridSize: number | null;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
  spacings: Spacing[];
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

// ---- per-axis snap candidates ---------------------------------------------

type AxisSnap =
  | { offset: number; kind: "align"; guide: Guide }
  | { offset: number; kind: "grid" }
  | { offset: number; kind: "dist"; spacings: Spacing[] };

function alignSnap(
  axis: "x" | "y",
  edges: number[],
  perp: [number, number],
  cands: Candidate[],
  threshold: number
): AxisSnap | null {
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
  return {
    offset: best.offset,
    kind: "align",
    guide: { axis, value: best.value, from: lo, to: hi },
  };
}

function gridSnap(edges: number[], grid: number, threshold: number): AxisSnap | null {
  let best: number | null = null;
  for (const e of edges) {
    const off = Math.round(e / grid) * grid - e;
    if (Math.abs(off) <= threshold && (best === null || Math.abs(off) < Math.abs(best))) {
      best = off;
    }
  }
  return best === null ? null : { offset: best, kind: "grid" };
}

/**
 * Distribution snap: centre the moving box in the gap between two neighbours
 * that overlap it on the cross axis, producing equal-spacing markers.
 */
function distSnap(
  horizontal: boolean,
  box: Bounds,
  boxes: Bounds[],
  threshold: number
): AxisSnap | null {
  // Coordinates along the snapping axis vs. the cross axis.
  const lo = horizontal ? box.x : box.y;
  const size = horizontal ? box.width : box.height;
  const crossLo = horizontal ? box.y : box.x;
  const crossHi = crossLo + (horizontal ? box.height : box.width);
  const center = lo + size / 2;

  const band = boxes
    .map((b) => ({
      lo: horizontal ? b.x : b.y,
      size: horizontal ? b.width : b.height,
      cLo: horizontal ? b.y : b.x,
      cSize: horizontal ? b.height : b.width,
    }))
    .filter((b) => b.cLo < crossHi && b.cLo + b.cSize > crossLo)
    .sort((p, q) => p.lo - q.lo);

  let best: AxisSnap | null = null;
  for (let i = 0; i + 1 < band.length; i++) {
    const p = band[i];
    const q = band[i + 1];
    const pEnd = p.lo + p.size;
    const gap = q.lo - pEnd;
    if (gap < size) continue;
    const target = (pEnd + q.lo) / 2;
    const off = target - center;
    if (Math.abs(off) > threshold) continue;
    if (best && Math.abs(off) >= Math.abs(best.offset)) continue;

    const boxStart = target - size / 2;
    const pos = crossLo + (crossHi - crossLo) / 2;
    best = {
      offset: off,
      kind: "dist",
      spacings: [
        { horizontal, a: pEnd, b: boxStart, pos },
        { horizontal, a: boxStart + size, b: q.lo, pos },
      ],
    };
  }
  return best;
}

function pick(cands: (AxisSnap | null)[]): AxisSnap | null {
  let best: AxisSnap | null = null;
  for (const c of cands) {
    if (c && (!best || Math.abs(c.offset) < Math.abs(best.offset))) best = c;
  }
  return best;
}

/**
 * Snap a moving AABB to alignment lines, grid and equal-spacing positions.
 * Returns the extra offset to add on top of the raw move plus what to draw.
 */
export function computeSnap(
  box: Bounds,
  ctx: SnapContext,
  threshold: number
): SnapResult {
  const xEdges = [box.x, box.x + box.width / 2, box.x + box.width];
  const yEdges = [box.y, box.y + box.height / 2, box.y + box.height];

  const xPick = pick([
    alignSnap("x", xEdges, [box.y, box.y + box.height], ctx.targets.x, threshold),
    ctx.gridSize ? gridSnap(xEdges, ctx.gridSize, threshold) : null,
    distSnap(true, box, ctx.boxes, threshold),
  ]);
  const yPick = pick([
    alignSnap("y", yEdges, [box.x, box.x + box.width], ctx.targets.y, threshold),
    ctx.gridSize ? gridSnap(yEdges, ctx.gridSize, threshold) : null,
    distSnap(false, box, ctx.boxes, threshold),
  ]);

  const guides: Guide[] = [];
  const spacings: Spacing[] = [];
  if (xPick?.kind === "align") guides.push(xPick.guide);
  if (xPick?.kind === "dist") spacings.push(...xPick.spacings);
  if (yPick?.kind === "align") guides.push(yPick.guide);
  if (yPick?.kind === "dist") spacings.push(...yPick.spacings);

  return { dx: xPick?.offset ?? 0, dy: yPick?.offset ?? 0, guides, spacings };
}

export interface PointSnapContext {
  targets: SnapTargets;
  gridSize: number | null;
}

/**
 * Snap a single point to alignment lines and the grid (no distribution).
 * Used for shape creation, resize handles and vertex editing.
 */
export function snapPoint(
  p: Vec2,
  ctx: PointSnapContext,
  threshold: number
): { point: Vec2; guides: Guide[] } {
  const xPick = pick([
    alignSnap("x", [p.x], [p.y, p.y], ctx.targets.x, threshold),
    ctx.gridSize ? gridSnap([p.x], ctx.gridSize, threshold) : null,
  ]);
  const yPick = pick([
    alignSnap("y", [p.y], [p.x, p.x], ctx.targets.y, threshold),
    ctx.gridSize ? gridSnap([p.y], ctx.gridSize, threshold) : null,
  ]);

  const guides: Guide[] = [];
  if (xPick?.kind === "align") guides.push(xPick.guide);
  if (yPick?.kind === "align") guides.push(yPick.guide);

  return {
    point: { x: p.x + (xPick?.offset ?? 0), y: p.y + (yPick?.offset ?? 0) },
    guides,
  };
}
