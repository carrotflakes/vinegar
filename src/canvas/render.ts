import { subpathSegments } from "@/model/path/path";
import {
  expandBounds,
  frameLocalBounds,
  intersectBounds,
  shapeBounds,
  worldShapeBounds,
} from "@/model/geometry/bounds";
import { cachedBrushEnvelope } from "@/model/brush/brushOutline";
import {
  compoundChildren,
  isCompoundChild,
} from "@/model/path/compoundPath";
import {
  clippingContentIds,
  clippingMask,
  shapeFillRule,
} from "../model/clippingMask";
import { effectsMargin, hasEffects } from "../model/effects";
import {
  isIdentity,
  matrixScale,
  nodeWorldMatrix,
  transformBounds,
} from "@/model/geometry/matrix";
import {
  isSwatchRef,
  patternPlacement,
  resolvePaint,
  resolvePaintRef,
  type Paint,
  type PatternPaint,
} from "../model/paint";
import { effectiveRectCornerRadius, roundedRectSubpath } from "../model/roundedRect";
import {
  ancestorIds,
  isFrame,
  isGroup,
  isInstance,
  isShape,
} from "../model/scene";
import {
  effectiveStrokeAlignment,
  normalizeStrokeDash,
  STROKE_MITER_LIMIT,
} from "../model/stroke";
import type { Bounds, Document, DocumentAsset, Effect, FrameNode, ImageShape, Shape } from "../model/types";
import { screenToWorld, worldToScreen, type Viewport } from "@/model/geometry/viewport";
import { getAssetImage } from "../imageCache";
import { layoutTextWithCanvas } from "./textLayout";
import {
  renderCachesDisabled,
  renderCullingDisabled,
  renderProfilingEnabled,
} from "@/debug/renderFlags";

/**
 * Paint a render node. Groups and instances with opacity/blend are drawn into
 * an offscreen layer matching the target canvas, then composited in one draw.
 * `activeSymbols` tracks the symbol expansion stack to break (invalid) cycles.
 */
/**
 * A repeating transparency checkerboard tile (world-space cells), cached across
 * frames. Used as editor chrome behind a transparent frame; null in headless
 * contexts (SSR/tests) that lack canvas pattern support.
 */
let checkerTile: HTMLCanvasElement | null | undefined;
const checkerPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
function checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
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

interface PaintTraversal {
  visibleWorldBounds: Bounds;
  visualBounds: Map<string, Bounds | null>;
  cullExemptIds: Set<string>;
  stats: { paintedNodes: number; culledNodes: number };
  /** Definition children are painted under an instance transform, while their
   * indexed bounds are symbol-local. The instance itself is still culled. */
  cullingDisabled?: boolean;
}

function unionBounds(bounds: Array<Bounds | null>): Bounds | null {
  const list = bounds.filter((value): value is Bounds => value !== null);
  if (!list.length) return null;
  const x = Math.min(...list.map((value) => value.x));
  const y = Math.min(...list.map((value) => value.y));
  const right = Math.max(...list.map((value) => value.x + value.width));
  const bottom = Math.max(...list.map((value) => value.y + value.height));
  return { x, y, width: right - x, height: bottom - y };
}

const cullingShapeBoundsCache = new WeakMap<
  Shape,
  { bounds: Bounds; components?: Shape[] }
>();

/** Bounds caching is deliberately scoped to persisted document shapes.
 * Transient pen/pencil previews are mutable and must never enter this cache. */
function cachedCullingShapeBounds(shape: Shape, doc: Document): Bounds {
  if (renderCachesDisabled) return shapeBounds(shape, doc);
  const cached = cullingShapeBoundsCache.get(shape);
  if (shape.type !== "compoundPath") {
    if (cached) return cached.bounds;
    const bounds = shapeBounds(shape, doc);
    cullingShapeBoundsCache.set(shape, { bounds });
    return bounds;
  }
  const components = compoundChildren(doc, shape);
  if (
    cached?.components &&
    cached.components.length === components.length &&
    cached.components.every(
      (component, index) => component === components[index]
    )
  ) {
    return cached.bounds;
  }
  const bounds = shapeBounds(shape, doc);
  cullingShapeBoundsCache.set(shape, { bounds, components });
  return bounds;
}

/** Conservative painted bounds, including stroke and effects, for culling. */
function visualNodeWorldBounds(
  doc: Document,
  nodeId: string,
  cache: Map<string, Bounds | null>,
  visiting: Set<string> = new Set()
): Bounds | null {
  if (cache.has(nodeId)) return cache.get(nodeId) ?? null;
  if (visiting.has(nodeId)) return null;
  const node = doc.nodes[nodeId];
  if (!node || node.hidden) {
    cache.set(nodeId, null);
    return null;
  }
  visiting.add(nodeId);

  let bounds: Bounds | null;
  if (isShape(node)) {
    let local = cachedCullingShapeBounds(node, doc);
    if (node.type !== "brush" && node.stroke && node.strokeWidth > 0) {
      const alignment = effectiveStrokeAlignment(node);
      const strokeReach =
        alignment === "outside"
          ? node.strokeWidth * STROKE_MITER_LIMIT
          : alignment === "center"
            ? (node.strokeWidth * STROKE_MITER_LIMIT) / 2
            : 0;
      local = expandBounds(local, strokeReach);
    }
    local = expandBounds(local, effectsMargin(node.effects));
    bounds = transformBounds(local, nodeWorldMatrix(doc, node.id));
  } else if (isInstance(node)) {
    const definition = doc.symbols[node.symbolId];
    const content = definition
      ? visualNodeWorldBounds(doc, definition.rootNodeId, cache, visiting)
      : null;
    bounds = content
      ? transformBounds(content, nodeWorldMatrix(doc, node.id))
      : null;
    if (bounds) {
      bounds = expandBounds(
        bounds,
        effectsMargin(node.effects) * matrixScale(nodeWorldMatrix(doc, node.id))
      );
    }
  } else if (isFrame(node)) {
    const frameBounds = transformBounds(
      frameLocalBounds(node),
      nodeWorldMatrix(doc, node.id)
    );
    bounds = node.clipsContent
      ? frameBounds
      : unionBounds([
          frameBounds,
          ...node.childIds.map((id) =>
            visualNodeWorldBounds(doc, id, cache, visiting)
          ),
        ]) ?? frameBounds;
    bounds = expandBounds(
      bounds,
      effectsMargin(node.effects) * matrixScale(nodeWorldMatrix(doc, node.id))
    );
  } else if (isGroup(node)) {
    const children = unionBounds(
      clippingContentIds(doc, node).map((id) =>
        visualNodeWorldBounds(doc, id, cache, visiting)
      )
    );
    const mask = clippingMask(doc, node);
    bounds =
      children && mask
        ? intersectBounds(children, worldShapeBounds(doc, mask))
        : children;
    if (bounds) {
      bounds = expandBounds(
        bounds,
        effectsMargin(node.effects) * matrixScale(nodeWorldMatrix(doc, node.id))
      );
    }
  } else {
    bounds = null;
  }

  visiting.delete(nodeId);
  cache.set(nodeId, bounds);
  return bounds;
}

function paintNodeInternal(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  nodeId: string,
  preview?: Shape | null,
  hiddenShapeId?: string | null,
  activeSymbols: Set<string> = new Set(),
  /** Draw editor-only chrome (e.g. a transparent frame's checkerboard). Off for
   *  export so a transparent frame exports as actual transparency. */
  editorChrome = false,
  traversal?: PaintTraversal
): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  if (
    traversal &&
    !traversal.cullingDisabled &&
    !traversal.cullExemptIds.has(nodeId)
  ) {
    const bounds = visualNodeWorldBounds(
      doc,
      nodeId,
      traversal.visualBounds
    );
    if (!bounds || !intersectBounds(bounds, traversal.visibleWorldBounds)) {
      traversal.stats.culledNodes += 1;
      return;
    }
  }
  if (traversal) traversal.stats.paintedNodes += 1;
  if (isShape(node)) {
    if (node.hidden || node.id === hiddenShapeId) return;
    const shape = preview?.id === node.id ? preview : node;
    if (!hasEffects(shape.effects)) {
      paintShape(ctx, shape, doc.assets, doc, preview);
      return;
    }
    // Effects need the shape composited as a layer, so its own opacity/blend is
    // deferred to the final draw (content -> effects -> opacity/blend).
    const acq = acquireLayer(ctx);
    if (!acq) return;
    const { canvas: layer, lctx } = acq;
    lctx.setTransform(ctx.getTransform());
    paintShape(
      lctx,
      { ...shape, opacity: 1, blendMode: "normal" },
      doc.assets,
      doc,
      preview,
      shape
    );
    compositeEffects(ctx, layer, deviceScale(ctx), shape.effects, shape.opacity, shape.blendMode);
    return;
  }
  let childIds: string[];
  let mask: Shape | null = null;
  let symbolId: string | null = null;
  let frame: FrameNode | null = null;
  if (isGroup(node)) {
    mask = clippingMask(doc, node);
    childIds = clippingContentIds(doc, node);
  } else if (isFrame(node)) {
    childIds = node.childIds;
    frame = node;
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
    if (frame) {
      // A frame paints its background box, then clips children to it (viewport).
      if (frame.background) {
        target.fillStyle = frame.background;
        target.fillRect(0, 0, frame.width, frame.height);
      } else if (editorChrome) {
        // Transparent frame: show a checkerboard in the editor only (never in
        // export, where the frame stays truly transparent).
        const pattern = checkerPattern(target);
        if (pattern) {
          target.fillStyle = pattern;
          target.fillRect(0, 0, frame.width, frame.height);
        }
      }
      if (frame.clipsContent) {
        target.beginPath();
        target.rect(0, 0, frame.width, frame.height);
        target.clip();
      }
    }
    if (!mask) return;
    const geometry = preview?.id === mask.id ? preview : mask;
    const path = cachedShapePath(geometry, doc, preview);
    if (
      path &&
      typeof Path2D !== "undefined" &&
      typeof DOMMatrix !== "undefined" &&
      typeof Path2D.prototype.addPath === "function"
    ) {
      const transformed = new Path2D();
      transformed.addPath(path, new DOMMatrix(geometry.transform));
      target.clip(transformed, shapeFillRule(geometry));
      return;
    }
    target.save();
    target.transform(...geometry.transform);
    tracePath(target, geometry, true, doc, preview);
    target.restore();
    target.clip(shapeFillRule(geometry));
  };
  const alpha = node.opacity ?? 1;
  const blend = node.blendMode && node.blendMode !== "normal" ? node.blendMode : null;
  const effects = hasEffects(node.effects) ? node.effects : null;
  if (alpha >= 1 && !blend && !effects) {
    applyMask(ctx);
    const childTraversal =
      symbolId && traversal
        ? { ...traversal, cullingDisabled: true }
        : traversal;
    for (const childId of childIds) {
      paintNodeInternal(
        ctx,
        doc,
        childId,
        preview,
        hiddenShapeId,
        activeSymbols,
        editorChrome,
        childTraversal
      );
    }
    ctx.restore();
    if (symbolId) activeSymbols.delete(symbolId);
    return;
  }
  const acq = acquireLayer(ctx);
  if (!acq) {
    ctx.restore();
    if (symbolId) activeSymbols.delete(symbolId);
    return;
  }
  const { canvas: layer, lctx } = acq;
  lctx.setTransform(ctx.getTransform());
  const scale = deviceScale(ctx);
  applyMask(lctx);
  const childTraversal =
    symbolId && traversal
      ? { ...traversal, cullingDisabled: true }
      : traversal;
  for (const childId of childIds) {
    paintNodeInternal(
      lctx,
      doc,
      childId,
      preview,
      hiddenShapeId,
      activeSymbols,
      editorChrome,
      childTraversal
    );
  }
  ctx.restore();
  compositeEffects(ctx, layer, scale, effects, alpha, node.blendMode);
  if (symbolId) activeSymbols.delete(symbolId);
}

/** Paint one scene subtree without viewport culling (used by raster export). */
export function paintNode(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  nodeId: string,
  preview?: Shape | null,
  hiddenShapeId?: string | null,
  activeSymbols: Set<string> = new Set(),
  editorChrome = false
): void {
  paintNodeInternal(
    ctx,
    doc,
    nodeId,
    preview,
    hiddenShapeId,
    activeSymbols,
    editorChrome
  );
}

/**
 * Pool of full-size offscreen canvases reused across frames. Compositing an
 * opacity group, effect, mask or isolated stroke needs a target-sized layer;
 * allocating one per node per frame churns the GC during drags. Layers are
 * acquired and released in a balanced (stack-like) fashion within a frame, so a
 * simple free-list bounded by the deepest nesting suffices.
 */
const freeLayers: HTMLCanvasElement[] = [];
let poolWidth = 0;
let poolHeight = 0;
let activeLayerCounter: { calls: number } | null = null;

/** A cleared, default-state offscreen canvas matching the target's pixels. */
function acquireLayer(
  ctx: CanvasRenderingContext2D
): { canvas: HTMLCanvasElement; lctx: CanvasRenderingContext2D } | null {
  if (activeLayerCounter) activeLayerCounter.calls += 1;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (width !== poolWidth || height !== poolHeight) {
    // A resize/DPR change invalidates every pooled layer's dimensions.
    freeLayers.length = 0;
    poolWidth = width;
    poolHeight = height;
  }
  let canvas = freeLayers.pop();
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
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
  return { canvas, lctx };
}

/** Return a layer to the pool once its pixels have been composited out. */
function releaseLayer(canvas: HTMLCanvasElement): void {
  if (canvas.width === poolWidth && canvas.height === poolHeight) {
    freeLayers.push(canvas);
  }
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
  const intermediates: HTMLCanvasElement[] = [];
  for (const effect of effects ?? []) {
    const next = acquireLayer(ctx);
    if (!next) break;
    const nctx = next.lctx;
    if (effect.type === "blur") {
      nctx.filter = `blur(${effect.radius * scale}px)`;
      nctx.drawImage(src, 0, 0);
    } else if (effect.type === "color-adjust") {
      // Unitless, so no `scale`. Order matches the SVG feColorMatrix chain.
      nctx.filter =
        `brightness(${effect.brightness}) contrast(${effect.contrast}) ` +
        `saturate(${effect.saturation}) hue-rotate(${effect.hue}deg)`;
      nctx.drawImage(src, 0, 0);
    } else if (effect.type === "color-overlay") {
      // Tint masked by the content's own alpha: source-atop keeps the layer's
      // silhouette while mixing in `alpha` worth of the flood colour.
      nctx.drawImage(src, 0, 0);
      nctx.globalCompositeOperation = "source-atop";
      nctx.globalAlpha = Math.max(0, Math.min(1, effect.alpha));
      nctx.fillStyle = effect.color;
      nctx.fillRect(0, 0, next.canvas.width, next.canvas.height);
    } else {
      nctx.shadowColor = rgba(effect.color, effect.alpha);
      nctx.shadowBlur = effect.blur * scale;
      nctx.shadowOffsetX = effect.offsetX * scale;
      nctx.shadowOffsetY = effect.offsetY * scale;
      nctx.drawImage(src, 0, 0);
    }
    intermediates.push(next.canvas);
    src = next.canvas;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (blendMode && blendMode !== "normal") {
    ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
  }
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  // The pixels now live on `ctx`; the caller's content layer and every effect
  // stage can go back to the pool.
  releaseLayer(layer);
  for (const canvas of intermediates) releaseLayer(canvas);
}

type PathTarget = Pick<
  CanvasRenderingContext2D,
  | "rect"
  | "moveTo"
  | "lineTo"
  | "bezierCurveTo"
  | "closePath"
  | "ellipse"
>;

/** Append non-compound geometry to either a live canvas path or a Path2D. */
function appendPath(target: PathTarget, shape: Shape): void {
  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      if (effectiveRectCornerRadius(shape) <= 0) {
        target.rect(b.x, b.y, b.width, b.height);
        break;
      }
      const subpath = roundedRectSubpath(shape);
      const segments = subpathSegments(subpath);
      if (!segments.length) break;
      target.moveTo(segments[0].p0.x, segments[0].p0.y);
      for (const segment of segments) {
        target.bezierCurveTo(
          segment.c1.x,
          segment.c1.y,
          segment.c2.x,
          segment.c2.y,
          segment.p1.x,
          segment.p1.y
        );
      }
      target.closePath();
      break;
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      // CanvasRenderingContext2D.ellipse() connects from the current point to
      // the arc start. Compound paths already have a current point from the
      // preceding component, so explicitly start a new subpath first.
      target.moveTo(b.x + b.width, b.y + b.height / 2);
      target.ellipse(
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
      target.moveTo(shape.x1, shape.y1);
      target.lineTo(shape.x2, shape.y2);
      break;
    }
    case "path": {
      for (const sp of shape.subpaths) {
        const segs = subpathSegments(sp);
        if (segs.length === 0) {
          if (sp.anchors[0]) {
            const p = sp.anchors[0].p;
            target.moveTo(p.x, p.y);
          }
          continue;
        }
        target.moveTo(segs[0].p0.x, segs[0].p0.y);
        for (const s of segs) {
          if (
            s.c1.x === s.p0.x &&
            s.c1.y === s.p0.y &&
            s.c2.x === s.p1.x &&
            s.c2.y === s.p1.y
          ) {
            target.lineTo(s.p1.x, s.p1.y);
          } else {
            target.bezierCurveTo(
              s.c1.x,
              s.c1.y,
              s.c2.x,
              s.c2.y,
              s.p1.x,
              s.p1.y
            );
          }
        }
        if (sp.closed) target.closePath();
      }
      break;
    }
    case "brush": {
      const ring = cachedBrushEnvelope(shape);
      if (ring.length >= 2) {
        target.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) {
          target.lineTo(ring[i].x, ring[i].y);
        }
        target.closePath();
      }
      break;
    }
    case "compoundPath":
    case "image":
    case "text":
      break;
  }
}

const pathCache = new WeakMap<Shape, Path2D>();
const compoundPathCache = new WeakMap<
  Shape,
  { path: Path2D; components: Shape[] }
>();

/**
 * Immutable shape references make Path2D entries self-invalidating. Compound
 * paths additionally validate their component references because editing a
 * child does not replace the compound container.
 */
function cachedShapePath(
  shape: Shape,
  doc?: Document,
  preview?: Shape | null
): Path2D | null {
  // Pen and pencil drafts mutate in place between pointer events. Persisted
  // document shapes are immutable, but transient previews are not.
  if (shape === preview || renderCachesDisabled) return null;
  if (typeof Path2D === "undefined") return null;
  if (shape.type !== "compoundPath") {
    const cached = pathCache.get(shape);
    if (cached) return cached;
    const path = new Path2D();
    appendPath(path, shape);
    pathCache.set(shape, path);
    return path;
  }
  if (
    !doc ||
    typeof DOMMatrix === "undefined" ||
    typeof Path2D.prototype.addPath !== "function"
  ) {
    return null;
  }
  const components = shape.childIds.flatMap((id) => {
    const stored = doc.nodes[id];
    const component = preview?.id === id ? preview : stored;
    return isShape(component) &&
      isCompoundChild(component) &&
      !component.hidden
      ? [component]
      : [];
  });
  const cached = compoundPathCache.get(shape);
  if (
    cached &&
    cached.components.length === components.length &&
    cached.components.every((component, index) => component === components[index])
  ) {
    return cached.path;
  }
  const path = new Path2D();
  for (const component of components) {
    const child = cachedShapePath(component, doc, preview);
    if (!child) return null;
    path.addPath(child, new DOMMatrix(component.transform));
  }
  compoundPathCache.set(shape, { path, components });
  return path;
}

/** Build the geometry of a shape onto the current canvas path as a fallback. */
function tracePath(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  begin = true,
  doc?: Document,
  preview?: Shape | null
): void {
  if (begin) ctx.beginPath();
  if (shape.type !== "compoundPath") {
    appendPath(ctx, shape);
    return;
  }
  if (!doc) return;
  for (const id of shape.childIds) {
    const stored = doc.nodes[id];
    const component = preview?.id === id ? preview : stored;
    if (
      !isShape(component) ||
      !isCompoundChild(component) ||
      component.hidden
    ) {
      continue;
    }
    ctx.save();
    ctx.transform(...component.transform);
    tracePath(ctx, component, false, doc, preview);
    ctx.restore();
  }
}

/** Paint one shape (fill then stroke) in world coordinates. */
export function paintShape(
  ctx: CanvasRenderingContext2D,
  input: Shape,
  assets: Record<string, DocumentAsset> = {},
  doc?: Document,
  preview?: Shape | null,
  geometrySource: Shape = input
): void {
  // Resolve `swatch` fill/stroke references to concrete paint at the boundary,
  // so everything downstream stays reference-blind. A dangling ref becomes null
  // (no paint), matching the "skip" fallback. Only clone when a ref is present.
  const shape =
    doc && (isSwatchRef(input.fill) || isSwatchRef(input.stroke))
      ? ({
          ...input,
          fill: resolvePaintRef(input.fill, doc.swatches),
          stroke: resolvePaintRef(input.stroke, doc.swatches),
        } as Shape)
      : input;
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
  if (shape.type === "brush") {
    paintBrush(
      ctx,
      shape,
      assets,
      cachedShapePath(geometrySource, doc, preview)
    );
    ctx.restore();
    return;
  }
  const path = cachedShapePath(geometrySource, doc, preview);
  if (!path) tracePath(ctx, shape, true, doc, preview);
  const bounds = shapeBounds(shape, doc);

  // Canvas/SVG fill implicitly closes open subpaths without changing how
  // their strokes are traced, so only a standalone line is never fillable.
  const fillable =
    shape.fill !== null &&
    shape.type !== "line";
  if (fillable && shape.fill) {
    const style = resolveStyle(ctx, shape.fill, bounds, assets);
    // A null style is a pattern still decoding; skip until the cache repaints.
    if (style) {
      withPaintAlpha(ctx, shape.opacity, shape.fill, () => {
        ctx.fillStyle = style;
        if (path) ctx.fill(path, shapeFillRule(shape));
        else ctx.fill(shapeFillRule(shape));
      });
    }
  }
  if (shape.stroke !== null && shape.strokeWidth > 0) {
    paintVectorStroke(ctx, shape, bounds, assets, path, doc, preview);
  }
  ctx.restore();
}

/**
 * Paint a brush stroke: its variable-width envelope is filled (nonzero winding)
 * with the shape's `stroke` paint. There is no separate stroke pass — the
 * width lives in the geometry.
 */
function paintBrush(
  ctx: CanvasRenderingContext2D,
  shape: Extract<Shape, { type: "brush" }>,
  assets: Record<string, DocumentAsset>,
  path: Path2D | null
): void {
  if (shape.stroke === null) return;
  const ring = cachedBrushEnvelope(shape);
  if (ring.length < 3) return;
  const style = resolveStyle(ctx, shape.stroke, shapeBounds(shape), assets);
  // A null style is a pattern still decoding; skip until the cache repaints.
  if (!style) return;
  if (!path) {
    ctx.beginPath();
    ctx.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
    ctx.closePath();
  }
  withPaintAlpha(ctx, shape.opacity, shape.stroke, () => {
    ctx.fillStyle = style;
    if (path) ctx.fill(path, "nonzero");
    else ctx.fill("nonzero");
  });
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
  ctx.lineCap = shape.strokeCap;
  ctx.lineJoin = shape.strokeJoin;
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
  assets: Record<string, DocumentAsset>,
  path: Path2D | null,
  doc?: Document,
  preview?: Shape | null
): void {
  if (!shape.stroke) return;
  const alignment = effectiveStrokeAlignment(shape);
  if (alignment === "outside") {
    // PERF: this borrows a target-sized layer per outside-stroked shape on
    // every frame. The layer pool avoids the allocation churn; a tighter
    // device-space layer (including miter/effect padding) or caching the
    // isolated stroke until the shape/viewport changes would cut fill cost too.
    const acq = acquireLayer(ctx);
    if (!acq) return;
    const { canvas: layer, lctx } = acq;
    lctx.setTransform(ctx.getTransform());
    const style = resolveStyle(lctx, shape.stroke, bounds, assets);
    if (!style) {
      releaseLayer(layer);
      return;
    }
    lctx.strokeStyle = style;
    applyStrokeStyle(lctx, shape, shape.strokeWidth * 2);
    if (path) lctx.stroke(path);
    else {
      tracePath(lctx, shape, true, doc, preview);
      lctx.stroke();
    }
    lctx.globalCompositeOperation = "destination-out";
    lctx.globalAlpha = 1;
    lctx.fillStyle = "#000000";
    if (path) lctx.fill(path, shapeFillRule(shape));
    else {
      tracePath(lctx, shape, true, doc, preview);
      lctx.fill(shapeFillRule(shape));
    }
    withPaintAlpha(ctx, shape.opacity, shape.stroke, () => drawLayerInDeviceSpace(ctx, layer));
    releaseLayer(layer);
    return;
  }

  const style = resolveStyle(ctx, shape.stroke, bounds, assets);
  if (!style) return;
  withPaintAlpha(ctx, shape.opacity, shape.stroke, () => {
    ctx.save();
    if (alignment === "inside") {
      if (path) ctx.clip(path, shapeFillRule(shape));
      else {
        tracePath(ctx, shape, true, doc, preview);
        ctx.clip(shapeFillRule(shape));
        tracePath(ctx, shape, true, doc, preview);
      }
    }
    ctx.strokeStyle = style;
    applyStrokeStyle(
      ctx,
      shape,
      alignment === "inside" ? shape.strokeWidth * 2 : shape.strokeWidth
    );
    if (path) ctx.stroke(path);
    else ctx.stroke();
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
  // and outside alignment currently borrow a full target-sized alpha layer from
  // the pool. A tight glyph-bounds layer is the likely optimization if hot.
  const acq = acquireLayer(ctx);
  if (!acq) return;
  const { canvas: layer, lctx } = acq;
  lctx.setTransform(ctx.getTransform());
  lctx.font = ctx.font;
  lctx.textBaseline = "alphabetic";
  const style = resolveStyle(lctx, shape.stroke, bounds, assets);
  if (!style) {
    releaseLayer(layer);
    return;
  }
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
  releaseLayer(layer);
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
  if (paint.type === "pattern") return resolvePattern(ctx, paint, bounds, assets);
  return resolvePaint(ctx, paint, bounds);
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

export interface RenderPerformanceSample {
  paintNodeMs: number;
  acquireLayerCalls: number;
  paintedNodes: number;
  culledNodes: number;
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
  /** Grid line colors per tier; falls back to light-theme defaults. */
  gridColors?: { minor: string; major: string; axis: string };
  /** Paint these roots instead of `doc.rootIds` (symbol local view). */
  rootIds?: string[] | undefined;
  /** Omit this shape while an HTML overlay edits it. */
  hiddenShapeId?: string | null;
  /** Draw editor-only chrome (transparent-frame checkerboard). Off for export. */
  editorChrome?: boolean;
  /** Optional per-frame diagnostics for stress-document profiling. */
  onPerformanceSample?: ((sample: RenderPerformanceSample) => void) | undefined;
}

function visibleWorldBounds(
  viewport: Viewport,
  width: number,
  height: number
): Bounds {
  const corners = [
    screenToWorld(viewport, { x: 0, y: 0 }),
    screenToWorld(viewport, { x: width, y: 0 }),
    screenToWorld(viewport, { x: width, y: height }),
    screenToWorld(viewport, { x: 0, y: height }),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
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
  ctx.rotate(viewport.rotation);
  ctx.scale(viewport.flipX ? -viewport.scale : viewport.scale, viewport.scale);

  const cullExemptIds = new Set<string>();
  if (opts.preview && doc.nodes[opts.preview.id]) {
    cullExemptIds.add(opts.preview.id);
    for (const id of ancestorIds(doc, opts.preview.id)) {
      cullExemptIds.add(id);
    }
  }
  const traversal: PaintTraversal = {
    visibleWorldBounds: visibleWorldBounds(viewport, width, height),
    visualBounds: new Map(),
    cullExemptIds,
    stats: { paintedNodes: 0, culledNodes: 0 },
    cullingDisabled: renderCullingDisabled,
  };
  const debugProfile = renderProfilingEnabled;
  const collectPerformance = debugProfile || !!opts.onPerformanceSample;
  const layerCounter = { calls: 0 };
  const previousLayerCounter = activeLayerCounter;
  if (collectPerformance) activeLayerCounter = layerCounter;
  const startedAt =
    collectPerformance && typeof performance !== "undefined"
      ? performance.now()
      : 0;

  // A preview that shares a document shape's id supersedes it (the pen
  // extending an existing path); skip the stale copy underneath.
  try {
    for (const nodeId of opts.rootIds ?? doc.rootIds) {
      paintNodeInternal(
        ctx,
        doc,
        nodeId,
        opts.preview,
        opts.hiddenShapeId,
        undefined,
        opts.editorChrome,
        traversal
      );
    }
    if (opts.preview && !doc.nodes[opts.preview.id]) {
      paintShape(ctx, opts.preview, doc.assets, doc, opts.preview);
    }
  } finally {
    if (collectPerformance) activeLayerCounter = previousLayerCounter;
  }

  if (collectPerformance) {
    const endedAt =
      typeof performance !== "undefined" ? performance.now() : startedAt;
    const sample: RenderPerformanceSample = {
      paintNodeMs: endedAt - startedAt,
      acquireLayerCalls: layerCounter.calls,
      ...traversal.stats,
    };
    opts.onPerformanceSample?.(sample);
    if (debugProfile && typeof performance !== "undefined") {
      performance.clearMeasures("Vinegar paintNode");
      performance.measure("Vinegar paintNode", {
        start: startedAt,
        end: endedAt,
        detail: sample,
      });
      (
        globalThis as typeof globalThis & {
          __vinegarRenderPerformance?: RenderPerformanceSample;
        }
      ).__vinegarRenderPerformance = sample;
    }
  }

  ctx.restore();
}

/** World units between grid lines, doubled/halved to keep screen spacing readable. */
function gridStep(opts: RenderOptions): number {
  let step = opts.gridSize ?? 50;
  const scale = opts.viewport.scale;
  while (step * scale < 24) step *= 2;
  while (step * scale > 120) step /= 2;
  return step;
}

/** Every Nth grid line is drawn heavier to give a readable sense of scale. */
const GRID_MAJOR_EVERY = 5;
const GRID_MINOR_COLOR = "#eceef1";
const GRID_MAJOR_COLOR = "#d7dbe1";
const GRID_AXIS_COLOR = "#b4bac4";

/** Classify a world-grid line by its index from the origin. */
function gridTier(index: number): "axis" | "major" | "minor" {
  if (index === 0) return "axis";
  return index % GRID_MAJOR_EVERY === 0 ? "major" : "minor";
}

function drawGrid(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
  if (opts.viewport.rotation !== 0) {
    drawRotatedGrid(ctx, opts);
    return;
  }
  const { viewport, width, height } = opts;
  const worldStep = gridStep(opts);
  const step = worldStep * viewport.scale;
  const origin = worldToScreen(viewport, { x: 0, y: 0 });

  // Screen position of a line is origin + index * step; solve for the visible
  // index range so each line's tier can be derived from its distance to origin.
  const minor = new Path2D();
  const major = new Path2D();
  const axis = new Path2D();
  const pathFor = (tier: "axis" | "major" | "minor") =>
    tier === "axis" ? axis : tier === "major" ? major : minor;

  const kx0 = Math.ceil((0 - origin.x) / step);
  const kx1 = Math.floor((width - origin.x) / step);
  for (let k = kx0; k <= kx1; k++) {
    const x = Math.round(origin.x + k * step) + 0.5;
    const p = pathFor(gridTier(k));
    p.moveTo(x, 0);
    p.lineTo(x, height);
  }
  const ky0 = Math.ceil((0 - origin.y) / step);
  const ky1 = Math.floor((height - origin.y) / step);
  for (let k = ky0; k <= ky1; k++) {
    const y = Math.round(origin.y + k * step) + 0.5;
    const p = pathFor(gridTier(k));
    p.moveTo(0, y);
    p.lineTo(width, y);
  }

  const colors = opts.gridColors;
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors?.minor ?? GRID_MINOR_COLOR;
  ctx.stroke(minor);
  ctx.strokeStyle = colors?.major ?? GRID_MAJOR_COLOR;
  ctx.stroke(major);
  ctx.strokeStyle = colors?.axis ?? GRID_AXIS_COLOR;
  ctx.stroke(axis);
}

/**
 * Grid drawn in world space so the lines rotate with the canvas. Lines span the
 * world-space AABB of the visible screen rectangle, mapped back through the
 * viewport; per-pixel rounding is dropped since rotated lines aren't axis-aligned.
 */
function drawRotatedGrid(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
  const { viewport, width, height } = opts;
  const step = gridStep(opts);
  const corners = [
    screenToWorld(viewport, { x: 0, y: 0 }),
    screenToWorld(viewport, { x: width, y: 0 }),
    screenToWorld(viewport, { x: width, y: height }),
    screenToWorld(viewport, { x: 0, y: height }),
  ];
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));

  const minor = new Path2D();
  const major = new Path2D();
  const axis = new Path2D();
  const pathFor = (tier: "axis" | "major" | "minor") =>
    tier === "axis" ? axis : tier === "major" ? major : minor;

  for (let k = Math.floor(minX / step); k * step <= maxX; k++) {
    const x = k * step;
    const a = worldToScreen(viewport, { x, y: minY });
    const b = worldToScreen(viewport, { x, y: maxY });
    const p = pathFor(gridTier(k));
    p.moveTo(a.x, a.y);
    p.lineTo(b.x, b.y);
  }
  for (let k = Math.floor(minY / step); k * step <= maxY; k++) {
    const y = k * step;
    const a = worldToScreen(viewport, { x: minX, y });
    const b = worldToScreen(viewport, { x: maxX, y });
    const p = pathFor(gridTier(k));
    p.moveTo(a.x, a.y);
    p.lineTo(b.x, b.y);
  }

  const colors = opts.gridColors;
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors?.minor ?? GRID_MINOR_COLOR;
  ctx.stroke(minor);
  ctx.strokeStyle = colors?.major ?? GRID_MAJOR_COLOR;
  ctx.stroke(major);
  ctx.strokeStyle = colors?.axis ?? GRID_AXIS_COLOR;
  ctx.stroke(axis);
}
