// Screen-space geometry for the gradient tool's freeform annotator — one chip
// per colour point. A pure `doc -> controls` function shared by the overlay
// painter, hit-testing and the drag, so the three can never disagree (the same
// shape as `gradientHandles.ts`, whose space matrix it reuses).

import { shapeBounds } from "@/model/geometry/bounds";
import { applyMatrix, invertMatrix, multiply, shapeWorldMatrix } from "@/model/geometry/matrix";
import { type FreeformPaint, isFreeform } from "@/model/freeform";
import type { PaintTarget } from "@/model/paint";
import type { Bounds, Document, Matrix, Shape, Vec2 } from "@/model/types";
import { screenToWorld, type Viewport, worldToScreen } from "@/model/geometry/viewport";
import { spaceMatrix } from "./gradientHandles";

export interface FreeformPointHandle {
  id: string;
  /** Screen-space centre. */
  point: Vec2;
  color: string;
  alpha: number;
}

export interface FreeformControls {
  shape: Shape;
  target: PaintTarget;
  paint: FreeformPaint;
  /** Shape-local fill bounds — the box a bounds-relative field is laid on. */
  bounds: Bounds;
  /** Freeform paint space -> world. */
  toWorld: Matrix;
  points: FreeformPointHandle[];
  /** The active point's spread ring, or null when nothing is active. */
  spread: FreeformSpreadRing | null;
}

/**
 * The spread ring around the active colour point: its radius stands for the
 * point's `weight`, and dragging the knob on it sets that weight.
 *
 * The radius is measured in *screen* pixels rather than in the field's own
 * space, because `weight` is a relative multiplier with no length to it. It is
 * affine in the weight — never smaller than {@link SPREAD_MIN_RADIUS} — so the
 * ring always clears the point chip underneath and stays grabbable at any
 * weight, however small.
 */
export interface FreeformSpreadRing {
  pointId: string;
  /** Screen-space centre (the point itself). */
  center: Vec2;
  /** Screen-space radius. */
  radius: number;
  /** Screen-space knob to grab, sitting on the ring. */
  knob: Vec2;
}

/** Ring radius at weight 0, and how much a weight of 1 adds to it. */
const SPREAD_MIN_RADIUS = 14;
const SPREAD_SCALE = 16;

export const spreadRadius = (weight: number, chrome = 1): number =>
  (SPREAD_MIN_RADIUS + weight * SPREAD_SCALE) * chrome;

/** The weight a ring of `radius` screen pixels stands for. */
export const spreadWeight = (radius: number, chrome = 1): number =>
  Math.max(0.1, Math.min(4, (radius / chrome - SPREAD_MIN_RADIUS) / SPREAD_SCALE));

/** Freeform paint space -> world, for a paint about to be applied to `shape`. */
export function freeformToWorld(doc: Document, shape: Shape, paint: FreeformPaint): Matrix {
  return multiply(
    shapeWorldMatrix(doc, shape),
    spaceMatrix(paint.space, shapeBounds(shape, doc))
  );
}

/** Screen point in a freeform paint's own space — where every edit is expressed. */
export function screenToFreeformSpace(
  doc: Document,
  shape: Shape,
  paint: FreeformPaint,
  viewport: Viewport,
  screen: Vec2
): Vec2 | null {
  const inv = invertMatrix(freeformToWorld(doc, shape, paint));
  return inv ? applyMatrix(inv, screenToWorld(viewport, screen)) : null;
}

/**
 * The annotator for the shape's `target` paint, or null when that paint is not
 * a freeform gradient.
 */
export function freeformControls(
  doc: Document,
  shape: Shape | null,
  target: PaintTarget,
  viewport: Viewport,
  /** Id of the active point; its spread ring is the only one drawn. */
  activeId?: string | null,
  /** Chrome scale (touch enlarges it), applied to the spread ring. */
  chrome = 1
): FreeformControls | null {
  if (!shape) return null;
  const paint = shape[target];
  if (!isFreeform(paint)) return null;
  const bounds = shapeBounds(shape, doc);
  const toWorld = freeformToWorld(doc, shape, paint);
  const points = paint.points.map((p) => ({
    id: p.id,
    point: worldToScreen(viewport, applyMatrix(toWorld, p.position)),
    color: p.color,
    alpha: p.alpha,
  }));
  // Null activeId means "the first point", matching how the bar and the panel
  // resolve a missing selection.
  const active = paint.points.find((p) => p.id === activeId) ?? paint.points[0];
  const center = active ? points.find((p) => p.id === active.id)?.point : null;
  return {
    shape,
    target,
    paint,
    bounds,
    toWorld,
    points,
    spread:
      active && center
        ? {
            pointId: active.id,
            center,
            radius: spreadRadius(active.weight, chrome),
            knob: {
              x: center.x + spreadRadius(active.weight, chrome),
              y: center.y,
            },
          }
        : null,
  };
}

export type FreeformHandle =
  | { type: "point"; id: string }
  /** The active point's spread ring. */
  | { type: "spread"; id: string };

/**
 * The handle under `screen`. The spread knob wins a tie: it sits clear of the
 * chips by construction, so anything close to it was aimed at it.
 */
export function pickFreeformHandle(
  controls: FreeformControls,
  screen: Vec2,
  tolerance: number
): FreeformHandle | null {
  const ring = controls.spread;
  if (ring && Math.hypot(ring.knob.x - screen.x, ring.knob.y - screen.y) <= tolerance) {
    return { type: "spread", id: ring.pointId };
  }
  const id = pickFreeformPoint(controls, screen, tolerance);
  return id ? { type: "point", id } : null;
}

/** The colour point under `screen`, preferring the ones drawn last. */
export function pickFreeformPoint(
  controls: FreeformControls,
  screen: Vec2,
  tolerance: number
): string | null {
  let hit: string | null = null;
  let best = tolerance * tolerance;
  for (const p of controls.points) {
    const dx = p.point.x - screen.x;
    const dy = p.point.y - screen.y;
    const dist = dx * dx + dy * dy;
    // `<=` so a later point wins a tie, matching the paint order.
    if (dist <= best) {
      best = dist;
      hit = p.id;
    }
  }
  return hit;
}
