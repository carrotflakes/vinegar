import {
  brushCenterlineSamples,
  fitBrushAnchors,
  simplifyWidthSamples,
  type WidthSample,
} from "./brushOutline";
import { distToSegment } from "./hitTest";
import { makeId, type BrushShape, type Vec2 } from "./types";

// Surviving runs are re-fit after cutting; a modest local-unit epsilon keeps
// the anchor count down without visibly changing the line.
const SIMPLIFY_EPS = 0.75;
const WIDTH_EPS = 0.05;

/** Distance from p to an open polyline (single point falls back to distance). */
function distToPolyline(p: Vec2, pts: Vec2[]): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  }
  return best;
}

/**
 * Split a brush stroke along an eraser path (both in the brush's *local*
 * space). Centerline samples within `radius` of the path are removed; each
 * surviving run of ≥ 2 samples is re-fit into a new brush that keeps the
 * original style and transform. Returns:
 *   - `null` when the eraser never touched the stroke (keep the original),
 *   - `[]` when the whole stroke was erased,
 *   - one or more new `BrushShape`s otherwise (fresh ids).
 */
export function eraseBrush(
  shape: BrushShape,
  eraserPath: Vec2[],
  radius: number
): BrushShape[] | null {
  if (eraserPath.length === 0 || radius <= 0) return null;
  const samples = brushCenterlineSamples(shape);
  if (samples.length === 0) return null;

  const erased = samples.map((s) => distToPolyline(s.p, eraserPath) <= radius);
  if (!erased.some(Boolean)) return null; // untouched

  // Contiguous runs of surviving samples.
  const runs: WidthSample[][] = [];
  let current: WidthSample[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (erased[i]) {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push(samples[i]);
    }
  }
  if (current.length) runs.push(current);

  const pieces: BrushShape[] = [];
  for (const run of runs) {
    if (run.length < 2) continue;
    const simplified = simplifyWidthSamples(run, SIMPLIFY_EPS, WIDTH_EPS);
    const anchors = fitBrushAnchors(simplified.length >= 2 ? simplified : run);
    pieces.push({ ...shape, id: makeId("brush"), anchors });
  }
  return pieces;
}
