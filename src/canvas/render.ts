import { subpathSegments } from "../model/bezier";
import { shapeBounds } from "../model/bounds";
import {
  clippingContentIds,
  clippingMask,
  shapeFillRule,
} from "../model/clippingMask";
import { hasEffects } from "../model/effects";
import { isIdentity } from "../model/matrix";
import { resolvePaint, type Paint, type PatternPaint } from "../model/paint";
import { effectiveRectCornerRadius, roundedRectSubpath } from "../model/roundedRect";
import { isGroup, isInstance, isShape } from "../model/scene";
import {
  effectiveStrokeAlignment,
  normalizeStrokeDash,
  STROKE_MITER_LIMIT,
  strokeCap,
  strokeJoin,
} from "../model/stroke";
import type { Artboard, Bounds, Document, DocumentAsset, Effect, ImageShape, Shape } from "../model/types";
import { worldToScreen, type Viewport } from "../model/viewport";
import { getAssetImage } from "./imageCache";
import { layoutTextWithCanvas } from "./textLayout";

/**
 * Paint a render node. Groups and instances with opacity/blend are drawn into
 * an offscreen layer matching the target canvas, then composited in one draw.
 * `activeSymbols` tracks the symbol expansion stack to break (invalid) cycles.
 */
export function paintNode(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  nodeId: string,
  preview?: Shape | null,
  hiddenShapeId?: string | null,
  activeSymbols: Set<string> = new Set()
): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  if (isShape(node)) {
    if (node.hidden || node.id === hiddenShapeId) return;
    const shape = preview?.id === node.id ? preview : node;
    if (!hasEffects(shape.effects)) {
      paintShape(ctx, shape, doc.assets);
      return;
    }
    // Effects need the shape composited as a layer, so its own opacity/blend is
    // deferred to the final draw (content -> effects -> opacity/blend).
    const layer = makeLayer(ctx);
    const lctx = layer?.getContext("2d");
    if (!layer || !lctx) return;
    lctx.setTransform(ctx.getTransform());
    paintShape(lctx, { ...shape, opacity: 1, blendMode: undefined }, doc.assets);
    compositeEffects(ctx, layer, deviceScale(ctx), shape.effects, shape.opacity, shape.blendMode);
    return;
  }
  let childIds: string[];
  let mask: Shape | null = null;
  let symbolId: string | null = null;
  if (isGroup(node)) {
    mask = clippingMask(doc, node);
    childIds = clippingContentIds(doc, node);
  } else if (isInstance(node)) {
    if (activeSymbols.has(node.symbolId)) return;
    const def = doc.symbols[node.symbolId];
    if (!def) return;
    childIds = [def.rootNodeId];
    symbolId = node.symbolId;
  } else {
    return;
  }
  if (node.hidden) return;
  if (symbolId) activeSymbols.add(symbolId);
  ctx.save();
  ctx.transform(...node.transform);
  const applyMask = (target: CanvasRenderingContext2D) => {
    if (!mask) return;
    const geometry = preview?.id === mask.id ? preview : mask;
    target.save();
    target.transform(...geometry.transform);
    tracePath(target, geometry);
    target.restore();
    target.clip(shapeFillRule(geometry));
  };
  const alpha = node.opacity ?? 1;
  const blend = node.blendMode && node.blendMode !== "normal" ? node.blendMode : null;
  const effects = hasEffects(node.effects) ? node.effects : null;
  if (alpha >= 1 && !blend && !effects) {
    applyMask(ctx);
    for (const childId of childIds) paintNode(ctx, doc, childId, preview, hiddenShapeId, activeSymbols);
    ctx.restore();
    if (symbolId) activeSymbols.delete(symbolId);
    return;
  }
  const layer = makeLayer(ctx);
  const lctx = layer?.getContext("2d");
  if (!layer || !lctx) {
    ctx.restore();
    if (symbolId) activeSymbols.delete(symbolId);
    return;
  }
  lctx.setTransform(ctx.getTransform());
  const scale = deviceScale(ctx);
  applyMask(lctx);
  for (const childId of childIds) paintNode(lctx, doc, childId, preview, hiddenShapeId, activeSymbols);
  ctx.restore();
  compositeEffects(ctx, layer, scale, effects, alpha, node.blendMode);
  if (symbolId) activeSymbols.delete(symbolId);
}

/** A fresh offscreen canvas matching the target's pixel dimensions. */
function makeLayer(ctx: CanvasRenderingContext2D): HTMLCanvasElement | null {
  const layer = document.createElement("canvas");
  layer.width = ctx.canvas.width;
  layer.height = ctx.canvas.height;
  return layer;
}

/** World->device length scale of the current transform (for local-space effects). */
function deviceScale(ctx: CanvasRenderingContext2D): number {
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
 * Composite a fully-rendered content `layer` onto `ctx`, running the effect
 * stack first (each producing a new offscreen layer in device space), then
 * drawing the result 1:1 with the node's opacity and blend mode. `effects` may
 * be null to composite the bare layer (opacity/blend only).
 */
function compositeEffects(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  scale: number,
  effects: Effect[] | null,
  alpha: number,
  blendMode: string | undefined
): void {
  let src = layer;
  for (const effect of effects ?? []) {
    const next = makeLayer(ctx);
    const nctx = next?.getContext("2d");
    if (!next || !nctx) break;
    if (effect.type === "blur") {
      nctx.filter = `blur(${effect.radius * scale}px)`;
      nctx.drawImage(src, 0, 0);
    } else {
      nctx.shadowColor = rgba(effect.color, effect.alpha);
      nctx.shadowBlur = effect.blur * scale;
      nctx.shadowOffsetX = effect.offsetX * scale;
      nctx.shadowOffsetY = effect.offsetY * scale;
      nctx.drawImage(src, 0, 0);
    }
    src = next;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (blendMode && blendMode !== "normal") {
    ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
  }
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

/** Build the geometry of a shape onto the current canvas path. */
function tracePath(ctx: CanvasRenderingContext2D, shape: Shape, begin = true): void {
  if (begin) ctx.beginPath();
  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      if (effectiveRectCornerRadius(shape) <= 0) {
        ctx.rect(b.x, b.y, b.width, b.height);
        break;
      }
      const subpath = roundedRectSubpath(shape);
      const segments = subpathSegments(subpath);
      if (!segments.length) break;
      ctx.moveTo(segments[0].p0.x, segments[0].p0.y);
      for (const segment of segments) {
        ctx.bezierCurveTo(
          segment.c1.x,
          segment.c1.y,
          segment.c2.x,
          segment.c2.y,
          segment.p1.x,
          segment.p1.y
        );
      }
      ctx.closePath();
      break;
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      // CanvasRenderingContext2D.ellipse() connects from the current point to
      // the arc start. Compound paths already have a current point from the
      // preceding component, so explicitly start a new subpath first.
      ctx.moveTo(b.x + b.width, b.y + b.height / 2);
      ctx.ellipse(
        b.x + b.width / 2,
        b.y + b.height / 2,
        Math.max(b.width / 2, 0),
        Math.max(b.height / 2, 0),
        0,
        0,
        Math.PI * 2
      );
      break;
    }
    case "line": {
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      break;
    }
    case "path": {
      const pts = shape.points;
      if (pts.length === 0) break;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (shape.closed) ctx.closePath();
      break;
    }
    case "bezier": {
      for (const sp of shape.subpaths) {
        const segs = subpathSegments(sp);
        if (segs.length === 0) {
          if (sp.anchors[0]) {
            const p = sp.anchors[0].p;
            ctx.moveTo(p.x, p.y);
          }
          continue;
        }
        ctx.moveTo(segs[0].p0.x, segs[0].p0.y);
        for (const s of segs) {
          ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p1.x, s.p1.y);
        }
        if (sp.closed) ctx.closePath();
      }
      break;
    }
    case "polygon": {
      for (const ring of shape.polys.flat()) {
        if (ring.length === 0) continue;
        ctx.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
        ctx.closePath();
      }
      break;
    }
    case "compoundPath": {
      for (const component of shape.components) {
        ctx.save();
        ctx.transform(...component.transform);
        tracePath(ctx, component, false);
        ctx.restore();
      }
      break;
    }
    case "image":
    case "text":
      break;
  }
}

/** Paint one shape (fill then stroke) in world coordinates. */
export function paintShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  assets: Record<string, DocumentAsset> = {}
): void {
  ctx.save();
  ctx.globalAlpha = shape.opacity;
  if (shape.blendMode && shape.blendMode !== "normal") {
    ctx.globalCompositeOperation = shape.blendMode;
  }
  if (!isIdentity(shape.transform)) ctx.transform(...shape.transform);
  if (shape.type === "image") {
    paintImage(ctx, shape, assets[shape.assetId]);
    ctx.restore();
    return;
  }
  if (shape.type === "text") {
    paintText(ctx, shape, assets);
    ctx.restore();
    return;
  }
  tracePath(ctx, shape);
  const bounds = shapeBounds(shape);

  // Lines and open paths/curves are never filled.
  const fillable =
    shape.fill !== null &&
    shape.type !== "line" &&
    !(shape.type === "path" && !shape.closed) &&
    !(shape.type === "bezier" && !shape.subpaths.some((sp) => sp.closed));
  if (fillable && shape.fill) {
    const style = resolveStyle(ctx, shape.fill, bounds, assets);
    // A null style is a pattern still decoding; skip until the cache repaints.
    if (style) {
      withPaintAlpha(ctx, shape.opacity, shape.fill, () => {
        ctx.fillStyle = style;
        ctx.fill(
          shape.type === "polygon" || shape.type === "compoundPath"
            ? "evenodd"
            : "nonzero"
        );
      });
    }
  }
  if (shape.stroke !== null && shape.strokeWidth > 0) {
    paintVectorStroke(ctx, shape, bounds, assets);
  }
  ctx.restore();
}

function paintText(
  ctx: CanvasRenderingContext2D,
  shape: Extract<Shape, { type: "text" }>,
  assets: Record<string, DocumentAsset>
): void {
  const layout = layoutTextWithCanvas(ctx, shape);
  const bounds = shapeBounds(shape);
  ctx.textBaseline = "alphabetic";
  if (shape.fill) {
    const style = resolveStyle(ctx, shape.fill, bounds, assets);
    if (style) {
      withPaintAlpha(ctx, shape.opacity, shape.fill, () => {
        ctx.fillStyle = style;
        for (const line of layout.lines) {
          if (line.text) ctx.fillText(line.text, shape.x + line.x, shape.y + line.baseline);
        }
      });
    }
  }
  if (shape.stroke && shape.strokeWidth > 0) {
    paintTextStroke(ctx, shape, layout.lines, bounds, assets);
  }
}

function applyStrokeStyle(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  width: number
): void {
  ctx.lineWidth = width;
  ctx.lineCap = strokeCap(shape);
  ctx.lineJoin = strokeJoin(shape);
  ctx.miterLimit = STROKE_MITER_LIMIT;
  const dash = normalizeStrokeDash(shape.strokeDash);
  // The guard keeps lightweight SSR/test contexts compatible while real
  // Canvas contexts always reset the dash state for every shape.
  if (typeof ctx.setLineDash === "function") ctx.setLineDash(dash);
  ctx.lineDashOffset = shape.strokeDashOffset ?? 0;
}

function drawLayerInDeviceSpace(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function paintVectorStroke(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  bounds: Bounds,
  assets: Record<string, DocumentAsset>
): void {
  if (!shape.stroke) return;
  const alignment = effectiveStrokeAlignment(shape);
  if (alignment === "outside") {
    // PERF: this allocates a target-sized layer per outside-stroked shape on
    // every frame. If documents commonly contain many such shapes, replace it
    // with a tight device-space layer (including miter/effect padding) or cache
    // the isolated stroke until the shape/viewport changes.
    const layer = makeLayer(ctx);
    const lctx = layer?.getContext("2d");
    if (!layer || !lctx) return;
    lctx.setTransform(ctx.getTransform());
    const style = resolveStyle(lctx, shape.stroke, bounds, assets);
    if (!style) return;
    lctx.strokeStyle = style;
    applyStrokeStyle(lctx, shape, shape.strokeWidth * 2);
    tracePath(lctx, shape);
    lctx.stroke();
    lctx.globalCompositeOperation = "destination-out";
    lctx.globalAlpha = 1;
    lctx.fillStyle = "#000000";
    tracePath(lctx, shape);
    lctx.fill(shapeFillRule(shape));
    withPaintAlpha(ctx, shape.opacity, shape.stroke, () => drawLayerInDeviceSpace(ctx, layer));
    return;
  }

  const style = resolveStyle(ctx, shape.stroke, bounds, assets);
  if (!style) return;
  withPaintAlpha(ctx, shape.opacity, shape.stroke, () => {
    ctx.save();
    if (alignment === "inside") {
      tracePath(ctx, shape);
      ctx.clip(shapeFillRule(shape));
      tracePath(ctx, shape);
    }
    ctx.strokeStyle = style;
    applyStrokeStyle(
      ctx,
      shape,
      alignment === "inside" ? shape.strokeWidth * 2 : shape.strokeWidth
    );
    ctx.stroke();
    ctx.restore();
  });
}

function paintTextStroke(
  ctx: CanvasRenderingContext2D,
  shape: Extract<Shape, { type: "text" }>,
  lines: ReturnType<typeof layoutTextWithCanvas>["lines"],
  bounds: Bounds,
  assets: Record<string, DocumentAsset>
): void {
  if (!shape.stroke) return;
  const alignment = effectiveStrokeAlignment(shape);
  if (alignment === "center") {
    const style = resolveStyle(ctx, shape.stroke, bounds, assets);
    if (!style) return;
    withPaintAlpha(ctx, shape.opacity, shape.stroke, () => {
      ctx.strokeStyle = style;
      applyStrokeStyle(ctx, shape, shape.strokeWidth);
      for (const line of lines) {
        if (line.text) ctx.strokeText(line.text, shape.x + line.x, shape.y + line.baseline);
      }
    });
    return;
  }

  // PERF: live text has no Canvas path we can clip directly, so both inside
  // and outside alignment currently use a full target-sized alpha layer. A
  // tight glyph-bounds layer is the likely optimization if this becomes hot.
  const layer = makeLayer(ctx);
  const lctx = layer?.getContext("2d");
  if (!layer || !lctx) return;
  lctx.setTransform(ctx.getTransform());
  lctx.font = ctx.font;
  lctx.textBaseline = "alphabetic";
  const style = resolveStyle(lctx, shape.stroke, bounds, assets);
  if (!style) return;
  lctx.strokeStyle = style;
  applyStrokeStyle(lctx, shape, shape.strokeWidth * 2);
  for (const line of lines) {
    if (line.text) lctx.strokeText(line.text, shape.x + line.x, shape.y + line.baseline);
  }
  lctx.globalCompositeOperation = alignment === "inside" ? "destination-in" : "destination-out";
  lctx.globalAlpha = 1;
  lctx.fillStyle = "#000000";
  for (const line of lines) {
    if (line.text) lctx.fillText(line.text, shape.x + line.x, shape.y + line.baseline);
  }
  withPaintAlpha(ctx, shape.opacity, shape.stroke, () => drawLayerInDeviceSpace(ctx, layer));
}

/**
 * Canvas fill/stroke style for a paint. Patterns resolve to a CanvasPattern
 * from the decoded asset — null while it's still decoding or missing, so the
 * caller skips painting until the cache repaints. Solids and gradients defer
 * to the pure resolver (they bake their alpha into the style).
 */
function resolveStyle(
  ctx: CanvasRenderingContext2D,
  paint: Paint,
  bounds: Bounds,
  assets: Record<string, DocumentAsset>
): string | CanvasGradient | CanvasPattern | null {
  if (paint.type === "pattern") return resolvePattern(ctx, paint, assets);
  return resolvePaint(ctx, paint, bounds);
}

function resolvePattern(
  ctx: CanvasRenderingContext2D,
  paint: PatternPaint,
  assets: Record<string, DocumentAsset>
): CanvasPattern | null {
  const asset = assets[paint.assetId];
  const img = asset ? getAssetImage(asset) : null;
  if (!img) return null;
  const pat = ctx.createPattern(img, "repeat");
  if (!pat) return null;
  // The pattern lives in the shape's local space (transform already applied).
  pat.setTransform(
    new DOMMatrix()
      .translateSelf(paint.offset.x, paint.offset.y)
      .rotateSelf((paint.rotation * 180) / Math.PI)
      .scaleSelf(paint.scale)
  );
  return pat;
}

/**
 * Run `paint()` with the pattern's own alpha folded into the node opacity.
 * Solids/gradients carry alpha in their style, so only patterns adjust it.
 */
function withPaintAlpha(
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

/**
 * Draw a placed image, or a placeholder box while its pixels are still
 * decoding (the cache repaints the canvas once they arrive) or when the
 * asset is missing/broken.
 */
function paintImage(
  ctx: CanvasRenderingContext2D,
  shape: ImageShape,
  asset: DocumentAsset | undefined
): void {
  const b = shapeBounds(shape);
  if (b.width <= 0 || b.height <= 0) return;
  const img = asset ? getAssetImage(asset) : null;
  if (img) {
    ctx.drawImage(img, b.x, b.y, b.width, b.height);
    return;
  }
  ctx.fillStyle = "rgba(128, 134, 142, 0.15)";
  ctx.fillRect(b.x, b.y, b.width, b.height);
  ctx.strokeStyle = "rgba(128, 134, 142, 0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x, b.y, b.width, b.height);
}

export interface RenderOptions {
  width: number;
  height: number;
  dpr: number;
  viewport: Viewport;
  doc: Document;
  /** Transient shape being drawn (rubber-band preview). */
  preview?: Shape | null;
  background?: string;
  showGrid?: boolean;
  /** World units between grid lines (defaults to 50). */
  gridSize?: number;
  /** Paint these roots instead of `doc.rootIds` (symbol local view). */
  rootIds?: string[];
  /** Artboard frames/backdrops to draw under the scene (omit in symbol view). */
  artboards?: Artboard[];
  /** Omit this shape while an HTML overlay edits it. */
  hiddenShapeId?: string | null;
}

/** Full scene render: background, grid, shapes, preview. */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  opts: RenderOptions
): void {
  const { width, height, dpr, viewport, doc } = opts;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = opts.background ?? "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (opts.showGrid) drawGrid(ctx, opts);

  // World-space drawing.
  ctx.save();
  ctx.translate(viewport.offset.x, viewport.offset.y);
  ctx.scale(viewport.scale, viewport.scale);

  // Artboard backdrops and frames sit under the scene content.
  if (opts.artboards?.length) drawArtboards(ctx, opts.artboards, viewport.scale);

  // A preview that shares a document shape's id supersedes it (the pen
  // extending an existing path); skip the stale copy underneath.
  for (const nodeId of opts.rootIds ?? doc.rootIds) {
    paintNode(ctx, doc, nodeId, opts.preview, opts.hiddenShapeId);
  }
  if (opts.preview && !doc.nodes[opts.preview.id]) {
    paintShape(ctx, opts.preview, doc.assets);
  }

  ctx.restore();
}

/** Draw artboard backdrops (fill) and hairline frames, in world space. */
function drawArtboards(
  ctx: CanvasRenderingContext2D,
  artboards: Artboard[],
  scale: number
): void {
  ctx.save();
  ctx.lineWidth = 1 / scale;
  for (const ab of artboards) {
    if (ab.background) {
      ctx.fillStyle = ab.background;
      ctx.fillRect(ab.x, ab.y, ab.width, ab.height);
    }
    ctx.strokeStyle = "#c8ccd2";
    ctx.strokeRect(ab.x, ab.y, ab.width, ab.height);
  }
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
  const { viewport, width, height } = opts;
  const base = opts.gridSize ?? 50; // world units between major lines
  let step = base * viewport.scale;
  // Keep on-screen spacing readable across zoom levels.
  while (step < 24) step *= 2;
  while (step > 120) step /= 2;

  const origin = worldToScreen(viewport, { x: 0, y: 0 });
  const startX = origin.x - Math.ceil(origin.x / step) * step;
  const startY = origin.y - Math.ceil(origin.y / step) * step;

  ctx.strokeStyle = "#eceef1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x <= width; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = startY; y <= height; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }
  ctx.stroke();
}
