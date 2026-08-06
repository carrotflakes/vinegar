// Canvas 2D styles for gradient paints.
//
// The model describes every gradient as a unit-space ramp plus a matrix (see
// `model/gradient.ts`). Canvas can draw that directly whenever the matrix is a
// similarity — `createLinearGradient` survives any affine map, and circles stay
// circles for `createRadialGradient`/`createConicGradient`. A squashed or
// sheared radial/conic (the normal case for a bounds-relative gradient on a
// non-square shape) has no native form, so it is rasterised once into an
// offscreen canvas and returned as a `CanvasPattern` carrying the matrix.
// Those rasters are cached per context, keyed by the paint and the device
// scale, exactly like the image-pattern cache next door in `style.ts`.

import { rgba } from "@/model/color";
import {
  cycleRange,
  type GradientPaint,
  gradientMatrix,
  isSimilarity,
  linearEndpoints,
  type RenderStop,
  renderStops,
  sortedStops,
  tiledStops,
  unitCoverage,
} from "@/model/gradient";
import type { Bounds, Matrix } from "@/model/types";
import { renderCachesDisabled } from "@/debug/renderFlags";

/** Largest offscreen raster for a non-similarity gradient, per side. */
const MAX_RASTER = 2048;

export function gradientStyle(
  ctx: CanvasRenderingContext2D,
  paint: GradientPaint,
  bounds: Bounds,
  /** How far the paint reaches outside `bounds` (a stroke's outset). */
  overflow = 0
): string | CanvasGradient | CanvasPattern | null {
  const ramp = renderStops(paint);
  if (ramp.length === 0) return null;
  if (ramp.length === 1) return rgba(ramp[0]!.color, ramp[0]!.alpha);
  const m = gradientMatrix(paint, bounds);
  const cover = unitCoverage(m, bounds);
  if (!cover) return null;
  if (paint.kind === "linear") return linearStyle(ctx, paint, ramp, m, cover);
  if (isSimilarity(m)) {
    return paint.kind === "conic"
      ? conicStyle(ctx, ramp, m)
      : radialStyle(ctx, paint, ramp, m, cover);
  }
  return rasterStyle(ctx, paint, ramp, m, bounds, overflow);
}

const addStops = (grad: CanvasGradient, stops: RenderStop[]) => {
  for (const s of stops) grad.addColorStop(Math.max(0, Math.min(1, s.offset)), rgba(s.color, s.alpha));
  return grad;
};

/** A linear ramp is affine-invariant: two endpoints always suffice. */
function linearStyle(
  ctx: CanvasRenderingContext2D,
  paint: GradientPaint,
  ramp: RenderStop[],
  m: Matrix,
  cover: Bounds
): CanvasGradient | null {
  const ends = linearEndpoints(m);
  if (!ends) return null;
  const range = cycleRange(cover.x, cover.x + cover.width, paint.spread);
  const at = (t: number) => ({
    x: ends.from.x + (ends.to.x - ends.from.x) * t,
    y: ends.from.y + (ends.to.y - ends.from.y) * t,
  });
  const a = at(range.from);
  const b = at(range.to);
  const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  return addStops(grad, tiledStops(ramp, paint.spread, range));
}

/** The radius range a radial ramp must span to cover the shape. */
function radialRange(paint: GradientPaint, cover: Bounds): { from: number; to: number } {
  const far = Math.hypot(
    Math.max(Math.abs(cover.x), Math.abs(cover.x + cover.width)),
    Math.max(Math.abs(cover.y), Math.abs(cover.y + cover.height))
  );
  // A radial ramp always starts at the centre, so only the outer end repeats.
  return { from: 0, to: cycleRange(0, far, paint.spread).to };
}

function radialStyle(
  ctx: CanvasRenderingContext2D,
  paint: GradientPaint,
  ramp: RenderStop[],
  m: Matrix,
  cover: Bounds
): CanvasGradient {
  const scale = Math.hypot(m[0], m[1]);
  const range = radialRange(paint, cover);
  const grad = ctx.createRadialGradient(
    m[0] * paint.focal.x + m[2] * paint.focal.y + m[4],
    m[1] * paint.focal.x + m[3] * paint.focal.y + m[5],
    0,
    m[4],
    m[5],
    scale * range.to
  );
  return addStops(grad, tiledStops(ramp, paint.spread, range));
}

function conicStyle(
  ctx: CanvasRenderingContext2D,
  ramp: RenderStop[],
  m: Matrix
): CanvasGradient | null {
  // A conic ramp wraps by construction, so `spread` has nothing to do.
  if (typeof ctx.createConicGradient !== "function") return null;
  const grad = ctx.createConicGradient(Math.atan2(m[1], m[0]), m[4], m[5]);
  return addStops(grad, ramp);
}

/** The unit-space ramp itself, drawn in whatever space the context is in. */
function unitGradient(
  ctx: CanvasRenderingContext2D,
  paint: GradientPaint,
  ramp: RenderStop[],
  cover: Bounds
): CanvasGradient | null {
  if (paint.kind === "conic") {
    if (typeof ctx.createConicGradient !== "function") return null;
    return addStops(ctx.createConicGradient(0, 0, 0), ramp);
  }
  const range = radialRange(paint, cover);
  const grad = ctx.createRadialGradient(paint.focal.x, paint.focal.y, 0, 0, 0, range.to);
  return addStops(grad, tiledStops(ramp, paint.spread, range));
}

/**
 * Rasters are cached per context by *what they contain*, not by the identity of
 * the paint that asked for one. Documents are immutable, so every edit — a nudge
 * of an unrelated shape, an undo, a pasted copy — hands the renderer fresh paint
 * objects for artwork that has not changed; keying on identity would re-render
 * a full-size offscreen canvas for each of them. Bounded, oldest evicted first.
 */
const MAX_RASTERS = 16;

const rasterCaches = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

/** Everything the raster's pixels depend on. */
export function rasterKey(paint: GradientPaint, m: Matrix, rect: Bounds, w: number, h: number): string {
  const stops = sortedStops(paint.stops)
    .map((s) => `${s.offset.toFixed(4)}:${s.color}:${s.alpha.toFixed(3)}:${s.midpoint.toFixed(3)}`)
    .join("|");
  return [
    paint.kind,
    paint.spread,
    paint.interpolation,
    paint.alpha.toFixed(3),
    paint.ratio.toFixed(4),
    `${paint.focal.x.toFixed(4)},${paint.focal.y.toFixed(4)}`,
    m.map((n) => n.toFixed(3)).join(","),
    `${rect.x.toFixed(2)},${rect.y.toFixed(2)},${rect.width.toFixed(2)},${rect.height.toFixed(2)}`,
    `${w}x${h}`,
    stops,
  ].join(";");
}

/** Device pixels per local unit, so the raster matches the current zoom. */
function contextScale(ctx: CanvasRenderingContext2D): number {
  const t = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  if (!t) return 1;
  return Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d)) || 1;
}

/**
 * Rasterise an elliptical/sheared radial or conic ramp over the shape's
 * bounds, plus `overflow` — the paint reaches beyond the geometry bounds it is
 * laid out over whenever it is a stroke.
 */
function rasterStyle(
  ctx: CanvasRenderingContext2D,
  paint: GradientPaint,
  ramp: RenderStop[],
  m: Matrix,
  bounds: Bounds,
  overflow: number
): CanvasPattern | null {
  if (typeof document === "undefined" || typeof ctx.createPattern !== "function") return null;
  // A little slack on top of the stroke reach keeps antialiasing off the edge.
  const pad = overflow + 4;
  const rect: Bounds = {
    x: bounds.x - pad,
    y: bounds.y - pad,
    width: Math.max(bounds.width + pad * 2, 1),
    height: Math.max(bounds.height + pad * 2, 1),
  };
  const scale = contextScale(ctx);
  const w = Math.max(1, Math.min(MAX_RASTER, Math.ceil(rect.width * scale)));
  const h = Math.max(1, Math.min(MAX_RASTER, Math.ceil(rect.height * scale)));
  const key = rasterKey(paint, m, rect, w, h);
  let cache = renderCachesDisabled ? undefined : rasterCaches.get(ctx);
  if (!cache && !renderCachesDisabled) {
    cache = new Map();
    rasterCaches.set(ctx, cache);
  }
  const hit = cache?.get(key);
  if (hit) {
    // Refresh its place in the eviction order.
    cache!.delete(key);
    cache!.set(key, hit);
    return hit;
  }

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d");
  if (!octx) return null;
  const sx = w / rect.width;
  const sy = h / rect.height;
  octx.setTransform(sx, 0, 0, sy, -rect.x * sx, -rect.y * sy);
  octx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  const cover = unitCoverage(m, rect);
  if (!cover) return null;
  const grad = unitGradient(octx, paint, ramp, cover);
  if (!grad) return null;
  octx.fillStyle = grad;
  octx.fillRect(cover.x, cover.y, cover.width, cover.height);

  const pattern = ctx.createPattern(off, "no-repeat");
  if (!pattern) return null;
  if (typeof pattern.setTransform === "function" && typeof DOMMatrix !== "undefined") {
    pattern.setTransform(new DOMMatrix([1 / sx, 0, 0, 1 / sy, rect.x, rect.y]));
  }
  if (cache) {
    cache.set(key, pattern);
    if (cache.size > MAX_RASTERS) cache.delete(cache.keys().next().value!);
  }
  return pattern;
}
