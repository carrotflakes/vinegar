// Canvas 2D styles for freeform (scattered-point) gradients.
//
// The field has no native form anywhere, so it is evaluated per pixel by
// `model/freeform.ts` into an offscreen canvas and returned as a
// `CanvasPattern` placed over the shape's bounds — the same route the elliptical
// gradient rasters next door in `gradient.ts` take, including the per-context
// LRU keyed by *what the raster contains* rather than by paint identity.
//
// The one difference is resolution: a ramp raster is drawn at device scale
// because a hard stop has to stay hard, while a freeform field is smooth by
// construction. It is rasterised at `MAX_SIDE` per side at most and left to
// the canvas's bilinear upscaling, which turns an O(pixels × points) loop into
// a fixed ~65k-sample cost no matter how far the user has zoomed in.

import {
  type FreeformPaint,
  freeformRaster,
} from "@/model/freeform";
import type { Bounds } from "@/model/types";
import { renderCachesDisabled } from "@/debug/renderFlags";

/** Largest offscreen raster per side. The field is smooth; this is plenty. */
const MAX_SIDE = 256;
/** Rasters kept per context, oldest evicted first. */
const MAX_RASTERS = 16;

const rasterCaches = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

/** Everything the raster's pixels depend on. */
export function freeformRasterKey(
  paint: FreeformPaint,
  rect: Bounds,
  bounds: Bounds,
  w: number,
  h: number
): string {
  const points = paint.points
    .map(
      (p) =>
        `${p.position.x.toFixed(4)},${p.position.y.toFixed(4)}:${p.color}:` +
        `${p.alpha.toFixed(3)}:${p.weight.toFixed(3)}`
    )
    .join("|");
  const box = (b: Bounds) =>
    `${b.x.toFixed(2)},${b.y.toFixed(2)},${b.width.toFixed(2)},${b.height.toFixed(2)}`;
  return [
    paint.space,
    paint.method,
    paint.falloff.toFixed(4),
    paint.interpolation,
    paint.alpha.toFixed(3),
    box(rect),
    // A bounds-space field is laid out over the shape's box; a pinned one is
    // not, so its key must not change when an unrelated resize moves them.
    paint.space === "bounds" ? box(bounds) : "-",
    `${w}x${h}`,
    points,
  ].join(";");
}

/** Device pixels per local unit, so a zoomed-out shape rasterises smaller. */
function contextScale(ctx: CanvasRenderingContext2D): number {
  const t = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  if (!t) return 1;
  return Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d)) || 1;
}

/**
 * Canvas style for a freeform paint, or null in a context that cannot make
 * patterns (SSR/tests) — callers then skip painting.
 *
 * `bounds` is the shape's fill box (what `space: "bounds"` points are relative
 * to) and `overflow` how far the paint reaches outside it: a stroke is laid
 * out over the geometry bounds but paints outside them, and without the pad
 * a wide stroke would run off the raster.
 */
export function freeformStyle(
  ctx: CanvasRenderingContext2D,
  paint: FreeformPaint,
  bounds: Bounds,
  overflow = 0
): CanvasPattern | null {
  if (paint.points.length === 0) return null;
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
  const w = Math.max(1, Math.min(MAX_SIDE, Math.ceil(rect.width * scale)));
  const h = Math.max(1, Math.min(MAX_SIDE, Math.ceil(rect.height * scale)));

  const key = freeformRasterKey(paint, rect, bounds, w, h);
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
  const pixels = freeformRaster(paint, rect, bounds, w, h);
  octx.putImageData(new ImageData(pixels, w, h), 0, 0);

  const pattern = ctx.createPattern(off, "no-repeat");
  if (!pattern) return null;
  // Stretch the small raster back over `rect`; the context's own smoothing
  // does the interpolation between samples.
  if (typeof pattern.setTransform === "function" && typeof DOMMatrix !== "undefined") {
    pattern.setTransform(
      new DOMMatrix([rect.width / w, 0, 0, rect.height / h, rect.x, rect.y])
    );
  }
  if (cache) {
    cache.set(key, pattern);
    if (cache.size > MAX_RASTERS) cache.delete(cache.keys().next().value!);
  }
  return pattern;
}
