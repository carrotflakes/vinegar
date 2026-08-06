import { getAssetImage } from "@/imageCache";
import { rgba } from "@/model/color";
import {
  patternPlacement,
  type Paint,
  type PatternPaint,
} from "@/model/paint";
import { gradientStyle } from "./gradient";
import {
  normalizeStrokeDash,
  STROKE_MITER_LIMIT,
} from "@/model/stroke";
import type { Bounds, DocumentAsset, Shape } from "@/model/types";
import { renderCachesDisabled } from "@/debug/renderFlags";

/**
 * A repeating transparency checkerboard tile (world-space cells), cached across
 * frames. Used as editor chrome behind a transparent frame; null in headless
 * contexts (SSR/tests) that lack canvas pattern support.
 */
let checkerTile: HTMLCanvasElement | null | undefined;
const checkerPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
export function checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (typeof document === "undefined" || typeof ctx.createPattern !== "function") {
    return null;
  }
  const cached = renderCachesDisabled
    ? undefined
    : checkerPatterns.get(ctx);
  if (cached) return cached;
  if (checkerTile === undefined) {
    const tile = document.createElement("canvas");
    tile.width = 16;
    tile.height = 16;
    const tctx = tile.getContext("2d");
    if (!tctx) {
      checkerTile = null;
    } else {
      tctx.fillStyle = "#fbfbfc";
      tctx.fillRect(0, 0, 16, 16);
      tctx.fillStyle = "#e2e4e8";
      tctx.fillRect(0, 0, 8, 8);
      tctx.fillRect(8, 8, 8, 8);
      checkerTile = tile;
    }
  }
  const pattern = checkerTile ? ctx.createPattern(checkerTile, "repeat") : null;
  if (pattern && !renderCachesDisabled) {
    checkerPatterns.set(ctx, pattern);
  }
  return pattern;
}

/**
 * Canvas fill/stroke style for a paint (alpha baked in). Patterns resolve to a
 * CanvasPattern from the decoded asset — null while it's still decoding or
 * missing, so the caller skips painting until the cache repaints. `bounds` is
 * the shape-local box gradients and patterns are laid out over — a stroke is
 * laid out over the same box but paints outside it, hence `overflow`.
 */
export function resolveStyle(
  ctx: CanvasRenderingContext2D,
  paint: Paint,
  bounds: Bounds,
  assets: Record<string, DocumentAsset>,
  /** How far the paint reaches outside `bounds`; see {@link strokeOutset}. */
  overflow = 0
): string | CanvasGradient | CanvasPattern | null {
  if (paint.type === "pattern") return resolvePattern(ctx, paint, bounds, assets);
  if (paint.type === "gradient") return gradientStyle(ctx, paint, bounds, overflow);
  // A swatch reference is resolved by the caller before it reaches here.
  if (paint.type === "swatch") return null;
  return rgba(paint.color, paint.alpha);
}

interface CachedPattern {
  image: HTMLImageElement;
  boundsKey: string;
  pattern: CanvasPattern;
}

const patternCaches = new WeakMap<
  CanvasRenderingContext2D,
  WeakMap<PatternPaint, CachedPattern>
>();

function resolvePattern(
  ctx: CanvasRenderingContext2D,
  paint: PatternPaint,
  bounds: Bounds,
  assets: Record<string, DocumentAsset>
): CanvasPattern | null {
  const asset = assets[paint.assetId];
  const img = asset ? getAssetImage(asset) : null;
  if (!img) return null;
  let cache = renderCachesDisabled ? undefined : patternCaches.get(ctx);
  if (!cache) {
    cache = new WeakMap();
    if (!renderCachesDisabled) patternCaches.set(ctx, cache);
  }
  const boundsKey = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
  const cached = renderCachesDisabled ? undefined : cache.get(paint);
  if (
    cached &&
    cached.image === img &&
    cached.boundsKey === boundsKey
  ) {
    return cached.pattern;
  }
  // The pattern lives in the shape's local space (transform already applied).
  if (paint.mode === "tile") {
    const pat = ctx.createPattern(img, "repeat");
    if (!pat) return null;
    pat.setTransform(
      new DOMMatrix()
        .translateSelf(paint.offset.x, paint.offset.y)
        .rotateSelf((paint.rotation * 180) / Math.PI)
        .scaleSelf(paint.scale)
    );
    if (!renderCachesDisabled) {
      cache.set(paint, { image: img, boundsKey, pattern: pat });
    }
    return pat;
  }
  // fill / fit / stretch: a single image mapped onto the shape's bounds. The
  // no-repeat pattern is clipped to the filled path, so cover overflow crops.
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return null;
  const p = patternPlacement(paint, { width: iw, height: ih }, bounds);
  const pat = ctx.createPattern(img, "no-repeat");
  if (!pat) return null;
  pat.setTransform(
    new DOMMatrix().translateSelf(p.x, p.y).scaleSelf(p.width / iw, p.height / ih)
  );
  if (!renderCachesDisabled) {
    cache.set(paint, { image: img, boundsKey, pattern: pat });
  }
  return pat;
}

/**
 * Run `paint()` with the pattern's own alpha folded into the node opacity.
 * Solids/gradients carry alpha in their style, so only patterns adjust it.
 */
export function withPaintAlpha(
  ctx: CanvasRenderingContext2D,
  nodeOpacity: number,
  paint: Paint,
  paintFn: () => void
): void {
  if (paint.type !== "pattern" || paint.alpha >= 1) {
    paintFn();
    return;
  }
  ctx.globalAlpha = nodeOpacity * paint.alpha;
  paintFn();
  ctx.globalAlpha = nodeOpacity;
}

export function applyStrokeStyle(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  width: number
): void {
  ctx.lineWidth = width;
  ctx.lineCap = shape.strokeCap;
  ctx.lineJoin = shape.strokeJoin;
  ctx.miterLimit = STROKE_MITER_LIMIT;
  const dash = normalizeStrokeDash(shape.strokeDash);
  // The guard keeps lightweight SSR/test contexts compatible while real
  // Canvas contexts always reset the dash state for every shape.
  if (typeof ctx.setLineDash === "function") ctx.setLineDash(dash);
  ctx.lineDashOffset = shape.strokeDashOffset ?? 0;
}
