// Screen-space geometry for the gradient tool's annotator — the axis, its
// endpoint handles, the ellipse and focal knobs and the stop chips. A pure
// `doc -> controls` function shared by the overlay painter, hit-testing and the
// drag, so the three can never disagree (cf. `generatorHandles.ts`).

import { shapeBounds } from "@/model/geometry/bounds";
import { applyMatrix, invertMatrix, multiply, shapeWorldMatrix } from "@/model/geometry/matrix";
import {
  type GradientPaint,
  gradientAngle,
  isGradientPaint,
  sortedStops,
} from "@/model/gradient";
import type { PaintTarget } from "@/model/paint";
import { isShape } from "@/model/scene";
import type { Bounds, Document, Matrix, Shape, Vec2 } from "@/model/types";
import { worldToScreen, screenToWorld, type Viewport } from "@/model/geometry/viewport";

/** Screen-space distance the stop chips sit off the axis. */
const STOP_GUTTER = 13;

/** How far past the gutter a press still counts as being on the ramp. */
const RAMP_SLACK = 9;

export type GradientHandle =
  /** Ramp origin: the axis start, or the centre of a radial/conic. */
  | { type: "start" }
  /** Ramp end: sets both the angle and the length. */
  | { type: "end" }
  /** Second ellipse axis of a radial/conic ramp. */
  | { type: "ratio" }
  /** Radial focal point. */
  | { type: "focal" }
  | { type: "stop"; id: string }
  | { type: "midpoint"; id: string };

export interface GradientHandlePoint {
  handle: GradientHandle;
  /** Screen-space centre. */
  point: Vec2;
  /** Stop chips paint themselves in their own colour. */
  color?: string;
  alpha?: number;
}

export interface GradientControls {
  shape: Shape;
  target: PaintTarget;
  paint: GradientPaint;
  /** Shape-local fill bounds — the box a bounds-relative gradient is laid on. */
  bounds: Bounds;
  /** Gradient paint space -> world. */
  toWorld: Matrix;
  /** Screen-space axis ends, for the connecting line. */
  axis: { from: Vec2; to: Vec2 };
  /** Screen-space offset of the stop gutter from the axis. */
  gutter: Vec2;
  handles: GradientHandlePoint[];
}

/** The shape the gradient tool acts on: the single selected one, if any. */
export function gradientTargetShape(doc: Document, selection: string[]): Shape | null {
  if (selection.length !== 1) return null;
  const node = doc.nodes[selection[0]!];
  return isShape(node) && !node.locked ? node : null;
}

/** Maps the gradient's own space to the shape's local space. */
export function paintSpaceMatrix(paint: GradientPaint, bounds: Bounds): Matrix {
  return paint.space === "bounds"
    ? [bounds.width, 0, 0, bounds.height, bounds.x, bounds.y]
    : [1, 0, 0, 1, 0, 0];
}

/** Gradient paint space -> world, for a paint about to be applied to `shape`. */
export function paintToWorld(doc: Document, shape: Shape, paint: GradientPaint): Matrix {
  return multiply(shapeWorldMatrix(doc, shape), paintSpaceMatrix(paint, shapeBounds(shape, doc)));
}

/** Screen point in a gradient's own space — where every edit is expressed. */
export function screenToPaintSpace(
  doc: Document,
  shape: Shape,
  paint: GradientPaint,
  viewport: Viewport,
  screen: Vec2
): Vec2 | null {
  const inv = invertMatrix(paintToWorld(doc, shape, paint));
  return inv ? applyMatrix(inv, screenToWorld(viewport, screen)) : null;
}

/**
 * The annotator for the shape's `target` paint, or null when that paint is not
 * a gradient (the tool then creates one on the first drag).
 */
export function gradientControls(
  doc: Document,
  shape: Shape | null,
  target: PaintTarget,
  viewport: Viewport,
  /** Chrome scale (touch enlarges it), applied to the stop gutter. */
  chrome = 1
): GradientControls | null {
  if (!shape) return null;
  const paint = shape[target];
  if (!isGradientPaint(paint)) return null;
  const bounds = shapeBounds(shape, doc);
  const toWorld = paintToWorld(doc, shape, paint);
  const toScreen = (p: Vec2) => worldToScreen(viewport, applyMatrix(toWorld, p));

  const d = { x: paint.end.x - paint.start.x, y: paint.end.y - paint.start.y };
  const perp = { x: -d.y * paint.ratio, y: d.x * paint.ratio };
  const along = (t: number) => ({ x: paint.start.x + d.x * t, y: paint.start.y + d.y * t });

  const handles: GradientHandlePoint[] = [
    { handle: { type: "start" }, point: toScreen(paint.start) },
    { handle: { type: "end" }, point: toScreen(paint.end) },
  ];
  if (paint.kind !== "linear") {
    handles.push({
      handle: { type: "ratio" },
      point: toScreen({ x: paint.start.x + perp.x, y: paint.start.y + perp.y }),
    });
  }
  if (paint.kind === "radial") {
    handles.push({
      handle: { type: "focal" },
      point: toScreen({
        x: paint.start.x + d.x * paint.focal.x + perp.x * paint.focal.y,
        y: paint.start.y + d.y * paint.focal.x + perp.y * paint.focal.y,
      }),
    });
  }
  // Stop chips ride in a gutter beside the axis: at offset 0 and 1 they would
  // otherwise sit exactly under the origin and end handles, and nothing there
  // could be grabbed but the stop.
  const axisFrom = toScreen(paint.start);
  const axisTo = toScreen(paint.end);
  const axisLen = Math.hypot(axisTo.x - axisFrom.x, axisTo.y - axisFrom.y);
  const gutter =
    axisLen < 1e-6
      ? { x: 0, y: STOP_GUTTER * chrome }
      : {
          x: (-(axisTo.y - axisFrom.y) / axisLen) * STOP_GUTTER * chrome,
          y: ((axisTo.x - axisFrom.x) / axisLen) * STOP_GUTTER * chrome,
        };
  const beside = (t: number) => {
    const p = toScreen(along(t));
    return { x: p.x + gutter.x, y: p.y + gutter.y };
  };

  const stops = sortedStops(paint.stops);
  stops.forEach((s, i) => {
    const next = stops[i + 1];
    if (next) {
      handles.push({
        handle: { type: "midpoint", id: s.id },
        point: beside(s.offset + (next.offset - s.offset) * s.midpoint),
      });
    }
    handles.push({
      handle: { type: "stop", id: s.id },
      point: beside(s.offset),
      color: s.color,
      alpha: s.alpha,
    });
  });

  return {
    shape,
    target,
    paint,
    bounds,
    toWorld,
    axis: { from: axisFrom, to: axisTo },
    gutter,
    handles,
  };
}

/** The handle under `screen`, preferring the ones drawn last (stops on top). */
export function pickGradientHandle(
  controls: GradientControls,
  screen: Vec2,
  tolerance: number
): GradientHandle | null {
  let hit: GradientHandle | null = null;
  let best = tolerance * tolerance;
  for (const h of controls.handles) {
    const dx = h.point.x - screen.x;
    const dy = h.point.y - screen.y;
    const dist = dx * dx + dy * dy;
    // `<=` so a later handle wins a tie, matching the paint order.
    if (dist <= best) {
      best = dist;
      hit = h.handle;
    }
  }
  return hit;
}

/**
 * The ramp offset under `screen`, or null when the point is not on the ramp.
 * Measured in screen space against the drawn axis, so what counts as a hit is
 * the band the axis line and its stop gutter occupy — a click out on the
 * artwork misses, however far along the axis it projects.
 */
export function pickGradientRamp(
  controls: GradientControls,
  screen: Vec2,
  /** Chrome scale (touch enlarges it), as for {@link gradientControls}. */
  chrome = 1
): number | null {
  const { from, to } = controls.axis;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return null;
  const t = Math.max(0, Math.min(1, ((screen.x - from.x) * dx + (screen.y - from.y) * dy) / len2));
  const nearest = { x: from.x + dx * t, y: from.y + dy * t };
  const reach = (STOP_GUTTER + RAMP_SLACK) * chrome;
  return Math.hypot(screen.x - nearest.x, screen.y - nearest.y) <= reach ? t : null;
}

/** Angle of the axis in *screen* terms, so chrome can align with what is seen. */
export function screenAxisAngle(controls: GradientControls): number {
  const { from, to } = controls.axis;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.hypot(dx, dy) < 1e-6 ? gradientAngle(controls.paint) : Math.atan2(dy, dx);
}
