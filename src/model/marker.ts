import { transformSubpath } from "./path/path";
import { resolvedSubpaths } from "./path/pathModifiers";
import type {
  LineShape,
  Marker,
  MarkerShape,
  Matrix,
  PathShape,
  PathSubpath,
  SceneNode,
  Shape,
  StrokeCap,
  Vec2,
} from "./types";

/** The shapes that can be open, and so can carry end markers. */
export type MarkableShape = LineShape | PathShape;

export const DEFAULT_MARKER_SCALE = 1;

export function defaultMarker(shape: MarkerShape): Marker {
  return { shape, scale: DEFAULT_MARKER_SCALE, filled: true, flip: false };
}

export function isMarkable(
  node: SceneNode | null | undefined
): node is MarkableShape {
  return node?.type === "line" || node?.type === "path";
}

/** Whether `marker` is drawn as an outline rather than a solid area. */
export function isMarkerStroked(marker: Marker): boolean {
  return marker.shape === "arrow" || marker.shape === "bar" || !marker.filled;
}

/**
 * A marker contour in *unit* space: the marker points along +X and attaches at
 * the origin, with coordinates measured in stroke widths. `closed` contours are
 * areal (filled or hollow); open ones are always stroked.
 */
interface UnitContour {
  points: Vec2[];
  closed: boolean;
  /** Approximate with cubic arcs rather than straight segments (the circle). */
  round?: boolean;
}

const TRIANGLE_LENGTH = 4;
const TRIANGLE_HALF_WIDTH = 2.1;
const ARROW_LENGTH = 3.4;
const ARROW_HALF_WIDTH = 2.1;
const CIRCLE_RADIUS = 2;
const SQUARE_HALF = 1.7;
const DIAMOND_HALF_X = 2.4;
const DIAMOND_HALF_Y = 1.8;
const BAR_HALF = 1.9;

/**
 * Every marker's silhouette, tip (or centre) at the origin. Areal markers put
 * their tip at the attach point so the arrowhead does not overshoot the end;
 * symmetric ones (circle, square, diamond, bar) sit centred on it.
 */
const UNIT_CONTOURS: Record<MarkerShape, UnitContour> = {
  arrow: {
    closed: false,
    points: [
      { x: -ARROW_LENGTH, y: -ARROW_HALF_WIDTH },
      { x: 0, y: 0 },
      { x: -ARROW_LENGTH, y: ARROW_HALF_WIDTH },
    ],
  },
  triangle: {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: -TRIANGLE_LENGTH, y: TRIANGLE_HALF_WIDTH },
      { x: -TRIANGLE_LENGTH, y: -TRIANGLE_HALF_WIDTH },
    ],
  },
  circle: {
    closed: true,
    round: true,
    points: [
      { x: CIRCLE_RADIUS, y: 0 },
      { x: 0, y: CIRCLE_RADIUS },
      { x: -CIRCLE_RADIUS, y: 0 },
      { x: 0, y: -CIRCLE_RADIUS },
    ],
  },
  square: {
    closed: true,
    points: [
      { x: SQUARE_HALF, y: -SQUARE_HALF },
      { x: SQUARE_HALF, y: SQUARE_HALF },
      { x: -SQUARE_HALF, y: SQUARE_HALF },
      { x: -SQUARE_HALF, y: -SQUARE_HALF },
    ],
  },
  diamond: {
    closed: true,
    points: [
      { x: DIAMOND_HALF_X, y: 0 },
      { x: 0, y: DIAMOND_HALF_Y },
      { x: -DIAMOND_HALF_X, y: 0 },
      { x: 0, y: -DIAMOND_HALF_Y },
    ],
  },
  bar: {
    closed: false,
    points: [
      { x: 0, y: -BAR_HALF },
      { x: 0, y: BAR_HALF },
    ],
  },
};

/** Circle-arc control-point factor for a quarter turn. */
const KAPPA = 0.5522847498307936;

function unitSubpath(contour: UnitContour, size: number): PathSubpath {
  const points = contour.points.map((p) => ({ x: p.x * size, y: p.y * size }));
  if (!contour.round) {
    return {
      closed: contour.closed,
      anchors: points.map((p) => ({ p, hIn: null, hOut: null })),
    };
  }
  // A round contour's points are the quarter-turn extremes, in order; the
  // handles are tangent to the circle at each of them.
  return {
    closed: true,
    anchors: points.map((p, index) => {
      const radius = Math.hypot(p.x, p.y);
      // Tangent direction: 90° ahead of the radius, in the winding direction.
      const tangent = points[(index + 1) % points.length];
      const previous = points[(index + points.length - 1) % points.length];
      const dx = (tangent.x - previous.x) / 2;
      const dy = (tangent.y - previous.y) / 2;
      const length = Math.hypot(dx, dy) || 1;
      const hx = (dx / length) * KAPPA * radius;
      const hy = (dy / length) * KAPPA * radius;
      return {
        p,
        hIn: { x: p.x - hx, y: p.y - hy },
        hOut: { x: p.x + hx, y: p.y + hy },
      };
    }),
  };
}

/** How far a marker reaches from its attach point, in stroke widths. */
function unitReach(shape: MarkerShape): number {
  return UNIT_CONTOURS[shape].points.reduce(
    (max, p) => Math.max(max, Math.hypot(p.x, p.y)),
    0
  );
}

/**
 * How far the markers of `shape` paint beyond its geometry, in local units.
 * Stroked markers add half a pen width on top of their silhouette.
 */
export function markerOutset(shape: Shape): number {
  if (!isMarkable(shape) || !shape.stroke || shape.strokeWidth <= 0) return 0;
  let outset = 0;
  for (const marker of [shape.markerStart, shape.markerEnd]) {
    if (!marker) continue;
    const reach = unitReach(marker.shape) * shape.strokeWidth * marker.scale;
    outset = Math.max(
      outset,
      reach + (isMarkerStroked(marker) ? shape.strokeWidth / 2 : 0)
    );
  }
  return outset;
}

/** The direction a subpath leaves `p0` towards, or null for a degenerate one. */
function direction(from: Vec2, candidates: Vec2[]): Vec2 | null {
  for (const to of candidates) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length > 1e-9) return { x: dx / length, y: dy / length };
  }
  return null;
}

interface EndTangent {
  p: Vec2;
  /** Unit vector pointing out of the path at this end. */
  out: Vec2;
}

/**
 * The two ends of an open subpath, with the outward tangent at each. Only the
 * first and last segment matter, so this reads the four anchors it needs rather
 * than building every segment — markers are recomputed on every paint.
 */
function subpathEnds(subpath: PathSubpath): { start: EndTangent; end: EndTangent } | null {
  const anchors = subpath.anchors;
  if (subpath.closed || anchors.length < 2) return null;
  const [a0, a1] = anchors;
  const bLast = anchors[anchors.length - 1];
  const bPrev = anchors[anchors.length - 2];
  const forward = direction(a0.p, [a0.hOut ?? a0.p, a1.hIn ?? a1.p, a1.p]);
  const backward = direction(bLast.p, [
    bLast.hIn ?? bLast.p,
    bPrev.hOut ?? bPrev.p,
    bPrev.p,
  ]);
  if (!forward || !backward) return null;
  // Both tangents are measured pointing *into* the path, so both are reversed
  // to get the outward direction a marker faces.
  return {
    start: { p: a0.p, out: { x: -forward.x, y: -forward.y } },
    end: { p: bLast.p, out: { x: -backward.x, y: -backward.y } },
  };
}

/** One marker placed on the shape: its own geometry in the shape's local space. */
export interface MarkerContour {
  subpath: PathSubpath;
  /** Fill it with the stroke paint; otherwise trace it with the stroke pen. */
  filled: boolean;
}

function placeMarker(
  marker: Marker,
  at: EndTangent,
  strokeWidth: number
): MarkerContour | null {
  const size = strokeWidth * marker.scale;
  if (size <= 0) return null;
  const contour = UNIT_CONTOURS[marker.shape];
  const dx = marker.flip ? -at.out.x : at.out.x;
  const dy = marker.flip ? -at.out.y : at.out.y;
  // Rotate the unit contour's +X axis onto the outward direction, then move it
  // to the end point. Baking the placement into the geometry (rather than
  // leaving it as a transform) keeps marker and stroke in one coordinate
  // space, which is what makes a user-space gradient line up across both.
  const matrix: Matrix = [dx, dy, -dy, dx, at.p.x, at.p.y];
  return {
    subpath: transformSubpath(matrix, unitSubpath(contour, size)),
    filled: contour.closed && marker.filled,
  };
}

/**
 * Every open end of the resolved geometry, paired with the marker that sits on
 * it. Both ends of *every* open contour are marked: a shape's markers describe
 * how its strokes terminate, so a path holding several open contours terminates
 * all of them the same way.
 */
function endPlacements(
  shape: MarkableShape
): { at: EndTangent; marker: Marker | null }[] {
  return resolvedSubpaths(shape)
    .map(subpathEnds)
    .filter((ends): ends is { start: EndTangent; end: EndTangent } => !!ends)
    .flatMap((ends) => [
      { at: ends.start, marker: shape.markerStart ?? null },
      { at: ends.end, marker: shape.markerEnd ?? null },
    ]);
}

/**
 * Every marker contour of a shape, in the shape's local space, ready to be
 * filled or stroked with its stroke paint. Markers sit on the *resolved*
 * geometry, so they follow the modifier stack, and only open ends carry them —
 * a closed contour has none.
 */
export function markerContours(shape: Shape): MarkerContour[] {
  if (!isMarkable(shape) || !shape.stroke || shape.strokeWidth <= 0) return [];
  if (!shape.markerStart && !shape.markerEnd) return [];
  const out: MarkerContour[] = [];
  for (const { at, marker } of endPlacements(shape)) {
    if (!marker) continue;
    const placed = placeMarker(marker, at, shape.strokeWidth);
    if (placed) out.push(placed);
  }
  return out;
}

/**
 * A round or square cap, as geometry rather than as something the pen adds.
 * Half of it lies under the stroke; only the protruding half is ever visible.
 */
const CAP_CONTOURS: Record<Exclude<StrokeCap, "butt">, UnitContour> = {
  round: {
    closed: true,
    round: true,
    points: [
      { x: 0.5, y: 0 },
      { x: 0, y: 0.5 },
      { x: -0.5, y: 0 },
      { x: 0, y: -0.5 },
    ],
  },
  square: {
    closed: true,
    points: [
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
      { x: -0.5, y: 0.5 },
      { x: -0.5, y: -0.5 },
    ],
  },
};

/**
 * Whether the pen's own end caps are switched off for this shape, because a
 * marker takes over the end it sits on. A dash pattern opts out: there the cap
 * shapes every dash, not just the two ends of the path.
 */
export function suppressesStrokeCaps(shape: Shape): boolean {
  return (
    hasMarkers(shape) &&
    !!shape.stroke &&
    shape.strokeWidth > 0 &&
    shape.strokeCap !== "butt" &&
    !shape.strokeDash.some((entry) => entry > 0)
  );
}

/**
 * Everything painted at the ends of a stroke: its markers, plus the caps of the
 * ends that have no marker. Suppressing the pen's caps is what keeps a round
 * cap from poking out past an arrowhead's tip — but the ends the markers do not
 * claim still need theirs, so they are drawn back as ordinary contours.
 */
export function strokeEndContours(shape: Shape): MarkerContour[] {
  const out = markerContours(shape);
  if (!out.length || !suppressesStrokeCaps(shape) || !isMarkable(shape)) return out;
  const contour = CAP_CONTOURS[shape.strokeCap as Exclude<StrokeCap, "butt">];
  // Butt-capping the pen strips the caps of *every* open end, including the
  // interior ends of a multi-contour path that no marker claims.
  for (const { at, marker } of endPlacements(shape)) {
    if (marker) continue;
    const matrix: Matrix = [at.out.x, at.out.y, -at.out.y, at.out.x, at.p.x, at.p.y];
    out.push({
      subpath: transformSubpath(matrix, unitSubpath(contour, shape.strokeWidth)),
      filled: true,
    });
  }
  return out;
}

/**
 * A shape's markers as spreadable fields, for a conversion that builds a new
 * shape from an old one. Absent ends stay absent rather than becoming `null`.
 */
export function markerFields(
  shape: SceneNode
): Pick<MarkableShape, "markerStart" | "markerEnd"> {
  if (!isMarkable(shape)) return {};
  return {
    ...(shape.markerStart ? { markerStart: { ...shape.markerStart } } : {}),
    ...(shape.markerEnd ? { markerEnd: { ...shape.markerEnd } } : {}),
  };
}

/** Whether anything will actually be painted for this shape's markers. */
export function hasMarkers(shape: Shape): boolean {
  return isMarkable(shape) && !!(shape.markerStart || shape.markerEnd);
}
