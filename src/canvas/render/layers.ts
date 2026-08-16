import { expandBounds, intersectBounds } from "@/model/geometry/bounds";
import { transformBounds } from "@/model/geometry/matrix";
import { isGeometryEffect } from "@/model/effects";
import type { Bounds, Effect, GeometryEffect } from "@/model/types";

export interface RenderLayer {
  canvas: HTMLCanvasElement;
  lctx: CanvasRenderingContext2D;
  /** Device-space origin relative to the target context. */
  x: number;
  y: number;
}

/**
 * Temporary layers are bucketed by pixel dimensions. Their origins remain
 * exact device coordinates, while power-of-two sizes let nearby node sizes
 * reuse canvases without returning to full-viewport allocations.
 *
 * Layers are acquired and released in a stack-like fashion within a frame, so
 * the live count is the deepest nesting. The pool is capped well above that,
 * evicting from the least recently used bucket, so that a session that visits
 * many bucket sizes (or resizes the target, which changes the size clamp) can't
 * retain a canvas per size forever.
 */
const freeLayers = new Map<string, HTMLCanvasElement[]>();
const MAX_POOLED_LAYERS = 32;
let pooledLayerCount = 0;
let activeLayerCounter: LayerStats | null = null;

function bucketSize(size: number, limit: number): number {
  if (size >= limit) return limit;
  let bucket = 1;
  while (bucket < size) bucket *= 2;
  return Math.min(bucket, limit);
}

export function deviceBounds(
  ctx: CanvasRenderingContext2D,
  localBounds: Bounds,
  antialiasPadding = 1
): Bounds {
  const matrix = ctx.getTransform();
  return expandBounds(
    transformBounds(localBounds, [
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
      matrix.e,
      matrix.f,
    ]),
    antialiasPadding
  );
}

/**
 * Acquire a cleared offscreen canvas covering `requestedBounds` in the target
 * context's device coordinates. Omit bounds only for the defensive full-target
 * fallback.
 */
export function acquireLayer(
  ctx: CanvasRenderingContext2D,
  requestedBounds?: Bounds
): RenderLayer | null {
  const targetWidth = ctx.canvas.width;
  const targetHeight = ctx.canvas.height;
  const clipped = requestedBounds
    ? intersectBounds(requestedBounds, {
        x: 0,
        y: 0,
        width: targetWidth,
        height: targetHeight,
      })
    : { x: 0, y: 0, width: targetWidth, height: targetHeight };
  if (!clipped || clipped.width <= 0 || clipped.height <= 0) return null;

  const requiredWidth = Math.max(
    1,
    Math.ceil(clipped.x + clipped.width) - Math.floor(clipped.x)
  );
  const requiredHeight = Math.max(
    1,
    Math.ceil(clipped.y + clipped.height) - Math.floor(clipped.y)
  );
  const width = bucketSize(requiredWidth, targetWidth);
  const height = bucketSize(requiredHeight, targetHeight);
  const x = Math.max(0, Math.min(Math.floor(clipped.x), targetWidth - width));
  const y = Math.max(0, Math.min(Math.floor(clipped.y), targetHeight - height));
  const key = `${width}x${height}`;
  const bucket = freeLayers.get(key);
  let canvas = bucket?.pop();
  if (canvas) pooledLayerCount -= 1;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
  }
  if (activeLayerCounter) {
    activeLayerCounter.calls += 1;
    activeLayerCounter.pixels += width * height;
  }
  const lctx = canvas.getContext("2d");
  if (!lctx) return null;
  // A pooled canvas carries its previous pixels and context state; reset both
  // to the same clean slate a freshly created canvas would provide.
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalAlpha = 1;
  lctx.globalCompositeOperation = "source-over";
  lctx.filter = "none";
  lctx.shadowColor = "rgba(0, 0, 0, 0)";
  lctx.shadowBlur = 0;
  lctx.shadowOffsetX = 0;
  lctx.shadowOffsetY = 0;
  lctx.clearRect(0, 0, width, height);
  return { canvas, lctx, x, y };
}

/** Return a layer to the pool once its pixels have been composited out. */
export function releaseLayer(layer: RenderLayer): void {
  const key = `${layer.canvas.width}x${layer.canvas.height}`;
  const bucket = freeLayers.get(key) ?? [];
  bucket.push(layer.canvas);
  // Re-inserting moves the key last, so `freeLayers` iterates least recently
  // used first and the eviction below drops the size we stopped needing.
  freeLayers.delete(key);
  freeLayers.set(key, bucket);
  pooledLayerCount += 1;
  while (pooledLayerCount > MAX_POOLED_LAYERS) {
    const oldest = freeLayers.keys().next();
    if (oldest.done) break;
    const stale = freeLayers.get(oldest.value);
    if (!stale?.length) {
      freeLayers.delete(oldest.value);
      continue;
    }
    stale.shift();
    if (!stale.length) freeLayers.delete(oldest.value);
    pooledLayerCount -= 1;
  }
}

export function setLayerTransform(
  layer: RenderLayer,
  source: CanvasRenderingContext2D
): void {
  const matrix = source.getTransform();
  layer.lctx.setTransform(
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.e - layer.x,
    matrix.f - layer.y
  );
}

/** World->device length scale of the current transform (for local-space effects). */
export function deviceScale(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

function rgba(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Paints one geometry effect (fill / stroke) directly onto `target`, which
 * already holds everything the stack has produced so far. Supplied by the
 * caller, which is the only side that knows the node's outline; omitting it
 * makes fill/stroke entries inert (groups and other outline-less nodes).
 */
export type GeometryEffectPainter = (
  target: RenderLayer,
  effect: GeometryEffect
) => void;

/**
 * Composite a fully-rendered content `layer` onto `ctx`, running the effect
 * stack first (each pixel effect producing a new offscreen layer in device
 * space, each geometry effect painting onto the current one), then drawing the
 * result 1:1 with the node's opacity and blend mode. `effects` may be null to
 * composite the bare layer (opacity/blend only).
 */
export function compositeEffects(
  ctx: CanvasRenderingContext2D,
  layer: RenderLayer,
  scale: number,
  effects: Effect[] | null,
  alpha: number,
  blendMode: string | undefined,
  paintGeometry?: GeometryEffectPainter
): void {
  let src = layer;
  const intermediates: RenderLayer[] = [];
  const bounds = {
    x: layer.x,
    y: layer.y,
    width: layer.canvas.width,
    height: layer.canvas.height,
  };
  for (const effect of effects ?? []) {
    if (isGeometryEffect(effect)) {
      // Geometry effects add paint rather than transform pixels, so they go
      // straight onto the layer in hand — no extra allocation, and the next
      // pixel effect sees them as part of its input.
      paintGeometry?.(src, effect);
      continue;
    }
    const next = acquireLayer(ctx, bounds);
    if (!next) break;
    const nctx = next.lctx;
    const sourceX = src.x - next.x;
    const sourceY = src.y - next.y;
    if (effect.type === "blur") {
      nctx.filter = `blur(${effect.radius * scale}px)`;
      nctx.drawImage(src.canvas, sourceX, sourceY);
    } else if (effect.type === "color-adjust") {
      // Unitless, so no `scale`. Order matches the SVG feColorMatrix chain.
      nctx.filter =
        `brightness(${effect.brightness}) contrast(${effect.contrast}) ` +
        `saturate(${effect.saturation}) hue-rotate(${effect.hue}deg)`;
      nctx.drawImage(src.canvas, sourceX, sourceY);
    } else if (effect.type === "tint") {
      // Tint masked by the content's own alpha: source-atop keeps the layer's
      // silhouette while mixing in `alpha` worth of the flood colour.
      nctx.drawImage(src.canvas, sourceX, sourceY);
      nctx.globalCompositeOperation = "source-atop";
      nctx.globalAlpha = Math.max(0, Math.min(1, effect.alpha));
      nctx.fillStyle = effect.color;
      nctx.fillRect(0, 0, next.canvas.width, next.canvas.height);
    } else {
      nctx.shadowColor = rgba(effect.color, effect.alpha);
      nctx.shadowBlur = effect.blur * scale;
      nctx.shadowOffsetX = effect.offsetX * scale;
      nctx.shadowOffsetY = effect.offsetY * scale;
      nctx.drawImage(src.canvas, sourceX, sourceY);
    }
    intermediates.push(next);
    src = next;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (blendMode && blendMode !== "normal") {
    ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
  }
  ctx.drawImage(src.canvas, src.x, src.y);
  ctx.restore();
  // The pixels now live on `ctx`; the caller's content layer and every effect
  // stage can go back to the pool.
  releaseLayer(layer);
  for (const intermediate of intermediates) releaseLayer(intermediate);
}

/** Per-frame layer accounting, installed by `renderScene` while profiling. */
export interface LayerStats {
  calls: number;
  pixels: number;
}

/** Attribute every layer acquired inside `body` to `stats`. Nestable, so an
 *  export render inside a profiled frame restores the outer collector. */
export function withLayerStats<T>(stats: LayerStats, body: () => T): T {
  const previous = activeLayerCounter;
  activeLayerCounter = stats;
  try {
    return body();
  } finally {
    activeLayerCounter = previous;
  }
}

export function drawLayerInDeviceSpace(
  ctx: CanvasRenderingContext2D,
  layer: RenderLayer
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer.canvas, layer.x, layer.y);
  ctx.restore();
}
