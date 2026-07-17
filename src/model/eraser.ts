import { cubicPoint, type CubicSegment } from "./bezier";
import { distToSegment } from "./hitTest";
import { applyMatrix } from "./matrix";
import {
  makeId,
  type BrushAnchor,
  type BrushShape,
  type Matrix,
  type Vec2,
} from "./types";

interface BrushSegment extends CubicSegment {
  w0: number;
  w1: number;
}

interface ParameterInterval {
  start: number;
  end: number;
}

const MIN_INTERVAL = 1e-7;
const BOUNDARY_STEPS = 18;

/** Cubic segments of an open brush centerline, including endpoint widths. */
function brushSegments(shape: BrushShape): BrushSegment[] {
  const segments: BrushSegment[] = [];
  for (let i = 0; i + 1 < shape.anchors.length; i++) {
    const current = shape.anchors[i];
    const next = shape.anchors[i + 1];
    segments.push({
      p0: current.p,
      c1: current.hOut ?? current.p,
      c2: next.hIn ?? next.p,
      p1: next.p,
      w0: current.w,
      w1: next.w,
    });
  }
  return segments;
}

/** Distance from p to an open polyline (single point falls back to distance). */
function distToPolyline(p: Vec2, points: Vec2[]): number {
  if (points.length === 1) {
    return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  }
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    best = Math.min(best, distToSegment(p, points[i], points[i + 1]));
  }
  return best;
}

function lerpPoint(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/** Exact de Casteljau split, including the linearly interpolated width. */
function splitSegment(
  segment: BrushSegment,
  t: number
): [BrushSegment, BrushSegment] {
  const p01 = lerpPoint(segment.p0, segment.c1, t);
  const p12 = lerpPoint(segment.c1, segment.c2, t);
  const p23 = lerpPoint(segment.c2, segment.p1, t);
  const p012 = lerpPoint(p01, p12, t);
  const p123 = lerpPoint(p12, p23, t);
  const point = lerpPoint(p012, p123, t);
  const width = segment.w0 + (segment.w1 - segment.w0) * t;
  return [
    {
      p0: segment.p0,
      c1: p01,
      c2: p012,
      p1: point,
      w0: segment.w0,
      w1: width,
    },
    {
      p0: point,
      c1: p123,
      c2: p23,
      p1: segment.p1,
      w0: width,
      w1: segment.w1,
    },
  ];
}

/** Exact sub-curve over the original segment parameter range [start, end]. */
function sliceSegment(
  segment: BrushSegment,
  start: number,
  end: number
): BrushSegment {
  let piece = { ...segment };
  if (start > 0) {
    [, piece] = splitSegment(piece, start);
  }
  if (end < 1) {
    const relativeEnd = (end - start) / (1 - start);
    [piece] = splitSegment(piece, relativeEnd);
  }
  return piece;
}

/**
 * Choose a subdivision count whose world-space curve travel per interval is
 * bounded by `maxWorldStep`. For a cubic, |B'(t)| is at most three times its
 * longest transformed control edge.
 */
function subdivisionCount(
  segment: BrushSegment,
  matrix: Matrix,
  maxWorldStep: number
): number {
  const control = [
    segment.p0,
    segment.c1,
    segment.c2,
    segment.p1,
  ].map((point) => applyMatrix(matrix, point));
  let maxControlEdge = 0;
  for (let i = 0; i + 1 < control.length; i++) {
    maxControlEdge = Math.max(
      maxControlEdge,
      Math.hypot(
        control[i + 1].x - control[i].x,
        control[i + 1].y - control[i].y
      )
    );
  }
  return Math.max(
    18,
    Math.ceil((3 * maxControlEdge) / Math.max(maxWorldStep, 1e-6))
  );
}

function isErasedAt(
  segment: BrushSegment,
  t: number,
  worldMatrix: Matrix,
  eraserPathWorld: Vec2[],
  radiusWorld: number
): boolean {
  const world = applyMatrix(worldMatrix, cubicPoint(segment, t));
  return distToPolyline(world, eraserPathWorld) <= radiusWorld;
}

/**
 * Refine one outside/inside transition and return the parameter on the
 * surviving side. The initial interval is short enough that a single
 * transition is expected; repeated bisection makes the cut independent of the
 * detection sample spacing.
 */
function refineBoundary(
  segment: BrushSegment,
  start: number,
  end: number,
  startErased: boolean,
  worldMatrix: Matrix,
  eraserPathWorld: Vec2[],
  radiusWorld: number
): number {
  let a = start;
  let b = end;
  for (let i = 0; i < BOUNDARY_STEPS; i++) {
    const mid = (a + b) / 2;
    if (
      isErasedAt(
        segment,
        mid,
        worldMatrix,
        eraserPathWorld,
        radiusWorld
      ) === startErased
    ) {
      a = mid;
    } else {
      b = mid;
    }
  }
  return startErased ? b : a;
}

/** Surviving parameter intervals of one original cubic segment. */
function survivingIntervals(
  segment: BrushSegment,
  worldMatrix: Matrix,
  eraserPathWorld: Vec2[],
  radiusWorld: number
): { intervals: ParameterInterval[]; touched: boolean } {
  const count = subdivisionCount(segment, worldMatrix, radiusWorld / 2);
  const states = Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    return {
      t,
      erased: isErasedAt(
        segment,
        t,
        worldMatrix,
        eraserPathWorld,
        radiusWorld
      ),
    };
  });
  const intervals: ParameterInterval[] = [];
  let runStart: number | null = states[0].erased ? null : 0;

  for (let i = 1; i < states.length; i++) {
    const previous = states[i - 1];
    const current = states[i];
    if (previous.erased === current.erased) continue;
    const boundary = refineBoundary(
      segment,
      previous.t,
      current.t,
      previous.erased,
      worldMatrix,
      eraserPathWorld,
      radiusWorld
    );
    if (previous.erased) {
      runStart = boundary;
    } else {
      if (runStart !== null && boundary - runStart > MIN_INTERVAL) {
        intervals.push({ start: runStart, end: boundary });
      }
      runStart = null;
    }
  }

  if (
    !states[states.length - 1].erased &&
    runStart !== null &&
    1 - runStart > MIN_INTERVAL
  ) {
    intervals.push({ start: runStart, end: 1 });
  }
  return {
    intervals,
    touched: states.some((state) => state.erased),
  };
}

function handleOrNull(handle: Vec2, anchor: Vec2): Vec2 | null {
  return Math.hypot(handle.x - anchor.x, handle.y - anchor.y) <= 1e-12
    ? null
    : { ...handle };
}

/** Convert contiguous exact cubic pieces back to the brush anchor convention. */
function anchorsFromSegments(segments: BrushSegment[]): BrushAnchor[] {
  const first = segments[0];
  if (!first) return [];
  const anchors: BrushAnchor[] = [
    {
      p: { ...first.p0 },
      hIn: null,
      hOut: handleOrNull(first.c1, first.p0),
      w: first.w0,
    },
  ];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const next = segments[i + 1];
    anchors.push({
      p: { ...segment.p1 },
      hIn: handleOrNull(segment.c2, segment.p1),
      hOut: next ? handleOrNull(next.c1, next.p0) : null,
      w: segment.w1,
    });
  }
  return anchors;
}

/**
 * Split a brush along a world-space eraser path. Detection is sampled
 * adaptively, but surviving geometry is cut directly from the original cubic
 * segments with de Casteljau subdivision; untouched spans are never re-fit.
 */
export function eraseBrush(
  shape: BrushShape,
  eraserPathWorld: Vec2[],
  radiusWorld: number,
  worldMatrix: Matrix
): BrushShape[] | null {
  if (eraserPathWorld.length === 0 || radiusWorld <= 0) return null;
  const segments = brushSegments(shape);
  if (segments.length === 0) {
    const anchor = shape.anchors[0];
    if (!anchor) return null;
    const world = applyMatrix(worldMatrix, anchor.p);
    return distToPolyline(world, eraserPathWorld) <= radiusWorld ? [] : null;
  }

  const runs: BrushSegment[][] = [];
  let currentRun: BrushSegment[] | null = null;
  let previousSegment = -2;
  let previousEnd = -1;
  let touched = false;

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];
    const result = survivingIntervals(
      segment,
      worldMatrix,
      eraserPathWorld,
      radiusWorld
    );
    touched ||= result.touched;
    for (const interval of result.intervals) {
      const connected =
        currentRun !== null &&
        ((segmentIndex === previousSegment &&
          Math.abs(interval.start - previousEnd) <= MIN_INTERVAL) ||
          (segmentIndex === previousSegment + 1 &&
            previousEnd >= 1 - MIN_INTERVAL &&
            interval.start <= MIN_INTERVAL));
      let run: BrushSegment[] | null = currentRun;
      if (!connected || run === null) {
        run = [];
        currentRun = run;
        runs.push(run);
      }
      run.push(
        sliceSegment(segment, interval.start, interval.end)
      );
      previousSegment = segmentIndex;
      previousEnd = interval.end;
    }
  }

  if (!touched) return null;
  return runs
    .filter((run) => run.length > 0)
    .map((run) => ({
      ...shape,
      id: makeId("brush"),
      anchors: anchorsFromSegments(run),
    }));
}
