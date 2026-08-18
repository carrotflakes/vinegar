import { worldShapeBounds } from "./bounds";
import type { Bounds, Document, GuideLine, Shape, Vec2 } from "../types";

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

/** Persistent guide positions per axis, in world units. */
export interface GuidePositions {
  x: number[];
  y: number[];
}

export const NO_GUIDE_LINES: GuidePositions = { x: [], y: [] };

/** Bucket document guides by axis for snapping. */
export function guidePositions(guides: readonly GuideLine[]): GuidePositions {
  const x: number[] = [];
  const y: number[] = [];
  for (const guide of guides) (guide.axis === "x" ? x : y).push(guide.position);
  return { x, y };
}

export interface SnapContext {
  targets: SnapTargets;
  /** Other shapes' world AABBs, used for distribution (equal spacing). */
  boxes: Bounds[];
  /** Grid size in world units, or null to disable grid snapping. */
  gridSize: number | null;
  /** Persistent guides to snap to (empty when guide snapping is off). */
  guideLines: GuidePositions;
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
export function collectSnapTargets(doc: Document, shapes: Shape[]): SnapTargets {
  const x: Candidate[] = [];
  const y: Candidate[] = [];
  for (const s of shapes) {
    const c = boxCandidates(worldShapeBounds(doc, s));
    x.push(...c.x);
    y.push(...c.y);
  }
  return { x, y };
}

/** Snap lines (left/center/right, top/middle/bottom) from raw AABBs — used for
 * non-shape targets such as frames. */
export function boundsSnapTargets(boxes: Bounds[]): SnapTargets {
  const x: Candidate[] = [];
  const y: Candidate[] = [];
  for (const b of boxes) {
    const c = boxCandidates(b);
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

/**
 * Snap to persistent guides. The guide is infinite, but the feedback line is
 * drawn over the moving box's own extent (`perp`) — an infinite overlay line
 * would just repaint the guide that is already on screen.
 */
function guideSnap(
  axis: "x" | "y",
  edges: number[],
  perp: [number, number],
  positions: number[],
  threshold: number
): AxisSnap | null {
  if (positions.length === 0) return null;
  return alignSnap(
    axis,
    edges,
    perp,
    positions.map((value) => ({ value, lo: perp[0], hi: perp[1] })),
    threshold
  );
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

/** Two gaps closer than this count as the same spacing. */
const GAP_EPSILON = 0.5;

/**
 * Distribution snap. Two ways to line up with the neighbours that overlap the
 * moving box on the cross axis:
 *  - centre it in the gap between two of them, and
 *  - repeat a gap that already exists in that band, either side of any
 *    neighbour — this is what continues an evenly spaced row when the moving
 *    box is dragged past its end, where there is no second neighbour to centre
 *    between.
 * Both produce equal-spacing markers; the matched source gaps are drawn too, so
 * it is visible *which* spacing is being repeated.
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
  const pos = crossLo + (crossHi - crossLo) / 2;

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
  /** Take `start` as the moving box's new position if it beats the current best. */
  const consider = (start: number, gaps: [number, number][]) => {
    const off = start - lo;
    if (Math.abs(off) > threshold) return;
    if (best && Math.abs(off) >= Math.abs(best.offset)) return;
    best = {
      offset: off,
      kind: "dist",
      spacings: gaps.map(([a, b]) => ({ horizontal, a, b, pos })),
    };
  };

  // Distinct gaps between consecutive neighbours, each with the spans to draw
  // when it gets repeated.
  const gaps: { size: number; sources: [number, number][] }[] = [];
  for (let i = 0; i + 1 < band.length; i++) {
    const pEnd = band[i].lo + band[i].size;
    const gap = band[i + 1].lo - pEnd;
    if (gap <= GAP_EPSILON) continue;
    const known = gaps.find((g) => Math.abs(g.size - gap) < GAP_EPSILON);
    if (known) known.sources.push([pEnd, band[i + 1].lo]);
    else gaps.push({ size: gap, sources: [[pEnd, band[i + 1].lo]] });
  }

  for (let i = 0; i + 1 < band.length; i++) {
    const p = band[i];
    const q = band[i + 1];
    const pEnd = p.lo + p.size;
    if (q.lo - pEnd < size) continue;
    const start = (pEnd + q.lo - size) / 2;
    consider(start, [
      [pEnd, start],
      [start + size, q.lo],
    ]);
  }

  for (const gap of gaps) {
    for (let i = 0; i < band.length; i++) {
      const b = band[i];
      const bEnd = b.lo + b.size;
      // After `b`: only legal if the box fits before the next neighbour.
      const after = bEnd + gap.size;
      const next = band[i + 1];
      if (!next || after + size <= next.lo + GAP_EPSILON) {
        consider(after, [[bEnd, after], ...gap.sources]);
      }
      // Before `b`, symmetrically.
      const before = b.lo - gap.size - size;
      const prev = band[i - 1];
      if (!prev || prev.lo + prev.size <= before + GAP_EPSILON) {
        consider(before, [[before + size, b.lo], ...gap.sources]);
      }
    }
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

  const xPerp: [number, number] = [box.y, box.y + box.height];
  const yPerp: [number, number] = [box.x, box.x + box.width];
  const xPick = pick([
    alignSnap("x", xEdges, xPerp, ctx.targets.x, threshold),
    guideSnap("x", xEdges, xPerp, ctx.guideLines.x, threshold),
    ctx.gridSize ? gridSnap(xEdges, ctx.gridSize, threshold) : null,
    distSnap(true, box, ctx.boxes, threshold),
  ]);
  const yPick = pick([
    alignSnap("y", yEdges, yPerp, ctx.targets.y, threshold),
    guideSnap("y", yEdges, yPerp, ctx.guideLines.y, threshold),
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

const BOTH_AXES = { x: true, y: true };

export interface PointSnapContext {
  targets: SnapTargets;
  gridSize: number | null;
  guideLines: GuidePositions;
  /**
   * The axes the caller is free to move the point along. An axis left out is
   * neither snapped nor given a guide line: a dragged east handle and a
   * vertical guide both move in x only, and a horizontal line drawn for them
   * would promise an alignment that nothing can act on.
   */
  axes?: { x: boolean; y: boolean };
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
  const axes = ctx.axes ?? BOTH_AXES;
  const xPick = axes.x
    ? pick([
        alignSnap("x", [p.x], [p.y, p.y], ctx.targets.x, threshold),
        guideSnap("x", [p.x], [p.y, p.y], ctx.guideLines.x, threshold),
        ctx.gridSize ? gridSnap([p.x], ctx.gridSize, threshold) : null,
      ])
    : null;
  const yPick = axes.y
    ? pick([
        alignSnap("y", [p.y], [p.x, p.x], ctx.targets.y, threshold),
        guideSnap("y", [p.y], [p.x, p.x], ctx.guideLines.y, threshold),
        ctx.gridSize ? gridSnap([p.y], ctx.gridSize, threshold) : null,
      ])
    : null;

  const guides: Guide[] = [];
  if (xPick?.kind === "align") guides.push(xPick.guide);
  if (yPick?.kind === "align") guides.push(yPick.guide);

  return {
    point: { x: p.x + (xPick?.offset ?? 0), y: p.y + (yPick?.offset ?? 0) },
    guides,
  };
}
