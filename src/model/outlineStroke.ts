import ClipperLib, { type PolyNode } from "clipper-lib";
import { flattenSubpath } from "./bezier";
import { shapeBounds } from "./bounds";
import { contours, intPath, SCALE, treeToPolys } from "./clipperPaths";
import { applyMatrix } from "./matrix";
import { roundedRectPolyline } from "./roundedRect";
import {
  effectiveStrokeAlignment,
  normalizeStrokeDash,
  STROKE_MITER_LIMIT,
  strokeCap,
  strokeJoin,
} from "./stroke";
import type { Shape, Vec2 } from "./types";

interface Polyline {
  points: Vec2[];
  closed: boolean;
}

function withTransform(shape: Shape, points: Vec2[]): Vec2[] {
  return points.map((p) => applyMatrix(shape.transform, p));
}

/** The stroked centerline(s) of a shape, before rotation. */
function centerlines(shape: Shape): Polyline[] {
  switch (shape.type) {
    case "line":
      return [
        {
          points: [
            { x: shape.x1, y: shape.y1 },
            { x: shape.x2, y: shape.y2 },
          ],
          closed: false,
        },
      ];
    case "rect": {
      return [
        {
          points: roundedRectPolyline(shape),
          closed: true,
        },
      ];
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rx = b.width / 2;
      const ry = b.height / 2;
      const pts: Vec2[] = [];
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
      return [{ points: pts, closed: true }];
    }
    case "path":
      return [{ points: shape.points, closed: shape.closed }];
    case "bezier":
      return shape.subpaths.map((sp) => ({
        points: flattenSubpath(sp),
        closed: sp.closed,
      }));
    case "polygon":
      return shape.polys.flat().map((ring) => ({ points: ring, closed: true }));
    case "compoundPath":
      return shape.components.flatMap((component) =>
        centerlines(component).map((line) => ({
          ...line,
          points: line.points.map((point) => applyMatrix(component.transform, point)),
        }))
      );
    case "image":
    case "text":
      // Images never stroke.
      return [];
    case "brush":
      // Brush width lives in the filled envelope, not a stroked centerline;
      // outlining a brush into a polygon is deferred (see docs/brush-strokes.md).
      return [];
  }
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

/** Split a flattened centerline into its visible dash chunks in local units. */
function dashedCenterlines(shape: Shape, line: Polyline): Polyline[] {
  let dash = normalizeStrokeDash(shape.strokeDash);
  if (!dash.length) return [line];
  if (dash.length % 2) dash = [...dash, ...dash];
  const patternLength = dash.reduce((sum, value) => sum + value, 0);
  if (patternLength <= 0) return [line];

  let phase = ((shape.strokeDashOffset ?? 0) % patternLength + patternLength) % patternLength;
  let dashIndex = 0;
  while (phase > dash[dashIndex] && dash.length) {
    phase -= dash[dashIndex];
    dashIndex = (dashIndex + 1) % dash.length;
  }
  let remaining = dash[dashIndex] - phase;
  let on = dashIndex % 2 === 0;
  const points = line.closed && line.points.length
    ? [...line.points, line.points[0]]
    : line.points;
  const chunks: Polyline[] = [];
  let current: Vec2[] = [];

  const finishCurrent = () => {
    if (current.length >= 2) chunks.push({ points: current, closed: false });
    current = [];
  };
  const advancePattern = (at: Vec2, direction: Vec2) => {
    let guard = 0;
    while (remaining <= 1e-9 && guard++ <= dash.length) {
      if (on && dash[dashIndex] === 0 && strokeCap(shape) !== "butt") {
        // Clipper drops zero-length paths, while Canvas uses the cap to render
        // dotted patterns such as [0, gap]. A one-quantum segment preserves
        // that dot; changing SCALE changes this approximation too.
        const epsilon = 1 / SCALE;
        chunks.push({
          points: [at, { x: at.x + direction.x * epsilon, y: at.y + direction.y * epsilon }],
          closed: false,
        });
      }
      if (on) finishCurrent();
      dashIndex = (dashIndex + 1) % dash.length;
      on = dashIndex % 2 === 0;
      remaining = dash[dashIndex];
    }
  };

  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) continue;
    const direction = { x: dx / length, y: dy / length };
    let walked = 0;
    advancePattern(a, direction);
    while (walked < length - 1e-9) {
      const take = Math.min(remaining, length - walked);
      const start = { x: a.x + direction.x * walked, y: a.y + direction.y * walked };
      const end = { x: a.x + direction.x * (walked + take), y: a.y + direction.y * (walked + take) };
      if (on && take > 1e-9) {
        if (!current.length || !samePoint(current[current.length - 1], start)) current.push(start);
        current.push(end);
      }
      walked += take;
      remaining -= take;
      advancePattern(end, direction);
    }
  }
  finishCurrent();
  // Closed dashed contours deliberately remain open chunks. Joining the first
  // and last chunks across the seam would avoid a duplicate cap when the dash
  // phase leaves both ends "on", but needs careful wraparound length handling.
  return chunks;
}

function joinType(shape: Shape): number {
  switch (strokeJoin(shape)) {
    case "miter": return ClipperLib.JoinType.jtMiter;
    // Clipper has no true SVG/Canvas bevel join. jtSquare is the closest
    // available offset join and can differ at very acute corners.
    case "bevel": return ClipperLib.JoinType.jtSquare;
    case "round": return ClipperLib.JoinType.jtRound;
  }
}

function endType(shape: Shape, closed: boolean): number {
  if (closed) return ClipperLib.EndType.etClosedLine;
  switch (strokeCap(shape)) {
    case "butt": return ClipperLib.EndType.etOpenButt;
    case "square": return ClipperLib.EndType.etOpenSquare;
    case "round": return ClipperLib.EndType.etOpenRound;
  }
}

function alignOutline(shape: Shape, strokeTree: PolyNode): PolyNode {
  const alignment = effectiveStrokeAlignment(shape);
  if (alignment === "center") return strokeTree;
  const silhouette = centerlines(shape)
    .filter((line) => line.closed && line.points.length >= 3)
    .map((line) => intPath(withTransform(shape, line.points)));
  if (!silhouette.length) return strokeTree;
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(contours(strokeTree), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(silhouette, ClipperLib.PolyType.ptClip, true);
  const result = new ClipperLib.PolyTree();
  clipper.Execute(
    alignment === "inside"
      ? ClipperLib.ClipType.ctIntersection
      : ClipperLib.ClipType.ctDifference,
    result,
    ClipperLib.PolyFillType.pftEvenOdd,
    ClipperLib.PolyFillType.pftEvenOdd
  );
  return result;
}

/**
 * Outline a shape's stroke into a filled multi-polygon (world space, rotation
 * baked in), using Clipper's polygon offsetting. Dash chunks, cap/join and
 * inside/outside clipping mirror the live renderer as closely as the flattened
 * Clipper approximation permits.
 *
 * `halfWidthOverride` replaces the painted half-width and skips the
 * inside/outside alignment clipping: the bucket fill's centerline mode uses it
 * to build a hairline band along the geometric centerline instead of the full
 * stroke band.
 */
export function strokeOutline(
  shape: Shape,
  halfWidthOverride?: number
): Vec2[][][] | null {
  if (shape.stroke === null || shape.strokeWidth <= 0) return null;
  const alignment = effectiveStrokeAlignment(shape);
  const half =
    halfWidthOverride ??
    (alignment === "center" ? shape.strokeWidth / 2 : shape.strokeWidth);

  const co = new ClipperLib.ClipperOffset(STROKE_MITER_LIMIT, 0.25 * SCALE);
  let added = false;
  for (const pl of centerlines(shape)) {
    for (const dashed of dashedCenterlines(shape, pl)) {
      const pts = withTransform(shape, dashed.points);
      if (pts.length < 2) continue;
      co.AddPath(intPath(pts), joinType(shape), endType(shape, dashed.closed));
      added = true;
    }
  }
  if (!added) return null;

  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, half * SCALE);

  const polys = treeToPolys(
    halfWidthOverride != null ? tree : alignOutline(shape, tree)
  );
  return polys.length ? polys : null;
}
