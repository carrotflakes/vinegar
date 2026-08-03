import {
  expandBounds,
  intersectBounds,
  shapeBounds,
} from "@/model/geometry/bounds";
import { isIdentity, transformBounds } from "@/model/geometry/matrix";
import { cachedBrushEnvelope } from "@/model/brush/brushOutline";
import { clippingContentIds, clippingMask, shapeFillRule } from "@/model/clippingMask";
import { effectsMargin, hasEffects } from "@/model/effects";
import { isVarRef } from "@/model/paint";
import {
  documentScope,
  resolvePaint,
  scopeForNode,
  symbolScope,
  type VarScope,
} from "@/model/vars";
import { ancestorIds, isFrame, isGroup, isInstance, isShape } from "@/model/scene";
import { effectiveStrokeAlignment, STROKE_MITER_LIMIT } from "@/model/stroke";
import type {
  Bounds,
  Document,
  DocumentAsset,
  FrameNode,
  ImageShape,
  Shape,
} from "@/model/types";
import { getAssetImage } from "@/imageCache";
import { layoutTextWithCanvas } from "../textLayout";
import {
  renderCullingDisabled,
  renderProfilingEnabled,
} from "@/debug/renderFlags";
import {
  nodeLocalContentBounds,
  visibleWorldBounds,
  visualNodeWorldBounds,
  type PaintTraversal,
} from "./bounds";
import {
  acquireLayer,
  compositeEffects,
  deviceBounds,
  deviceScale,
  drawLayerInDeviceSpace,
  releaseLayer,
  setLayerTransform,
  withLayerStats,
} from "./layers";
import { cachedShapePath, tracePath } from "./path";
import {
  applyStrokeStyle,
  checkerPattern,
  resolveStyle,
  withPaintAlpha,
} from "./style";
import { drawGrid } from "./grid";
import type { RenderOptions, RenderPerformanceSample } from "./types";

export type { RenderOptions, RenderPerformanceSample } from "./types";

/**
 * Paint one scene node. Groups, frames and instances that need isolation
 * (opacity, blend, mask or effects) are drawn into a temporary layer sized to
 * their device-space bounds, then composited in one draw.
 * `activeSymbols` tracks the symbol expansion stack to break (invalid) cycles.
 */
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
  traversal?: PaintTraversal,
  /** Variable lookup chain for `var` paints; instances push a frame onto it. */
  scope: VarScope = documentScope(doc)
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
      paintShape(ctx, shape, doc.assets, doc, preview, shape, scope);
      return;
    }
    // Effects need the shape composited as a layer, so its own opacity/blend is
    // deferred to the final draw (content -> effects -> opacity/blend).
    // The effect radius is a local-space length, so it scales with the shape's
    // own transform too — matching group effects, where `deviceScale` is read
    // after the node transform is applied.
    const shapeScale =
      Math.sqrt(
        Math.abs(
          shape.transform[0] * shape.transform[3] -
            shape.transform[1] * shape.transform[2]
        )
      ) || 1;
    const effectScale = deviceScale(ctx) * shapeScale;
    const contentBounds = nodeLocalContentBounds(
      doc,
      nodeId,
      preview,
      traversal?.layerBounds
    );
    const acq = acquireLayer(
      ctx,
      contentBounds
        ? expandBounds(
            deviceBounds(ctx, transformBounds(contentBounds, shape.transform)),
            effectsMargin(shape.effects) * effectScale
          )
        : undefined
    );
    if (!acq) return;
    const layer = acq;
    const { lctx } = layer;
    setLayerTransform(layer, ctx);
    paintShape(
      lctx,
      { ...shape, opacity: 1, blendMode: "normal" },
      doc.assets,
      doc,
      preview,
      shape,
      scope
    );
    compositeEffects(
      ctx,
      layer,
      effectScale,
      shape.effects,
      shape.opacity,
      shape.blendMode
    );
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
    // The instance's args over the definition's defaults, for everything the
    // descent paints below here. See docs/parameters.md.
    scope = symbolScope(scope, def, node);
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
        childTraversal,
        scope
      );
    }
    ctx.restore();
    if (symbolId) activeSymbols.delete(symbolId);
    return;
  }
  const scale = deviceScale(ctx);
  const contentBounds = nodeLocalContentBounds(
    doc,
    nodeId,
    preview,
    traversal?.layerBounds
  );
  const acq = acquireLayer(
    ctx,
    contentBounds
      ? expandBounds(
          deviceBounds(ctx, contentBounds),
          effectsMargin(effects ?? []) * scale
        )
      : undefined
  );
  if (!acq) {
    ctx.restore();
    if (symbolId) activeSymbols.delete(symbolId);
    return;
  }
  const layer = acq;
  const { lctx } = layer;
  setLayerTransform(layer, ctx);
  lctx.save();
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
      childTraversal,
      scope
    );
  }
  lctx.restore();
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
    editorChrome,
    undefined,
    scopeForNode(doc, nodeId)
  );
}

/** Paint one shape (fill then stroke) in world coordinates. */
export function paintShape(
  ctx: CanvasRenderingContext2D,
  input: Shape,
  assets: Record<string, DocumentAsset> = {},
  doc?: Document,
  preview?: Shape | null,
  geometrySource: Shape = input,
  scope?: VarScope
): void {
  // Resolve `var` fill/stroke references to concrete paint at the boundary, so
  // everything downstream stays reference-blind. A dangling ref becomes null
  // (no paint), matching the "skip" fallback. Only clone when a ref is present.
  const lookup = scope ?? (doc ? documentScope(doc) : null);
  const shape =
    lookup && (isVarRef(input.fill) || isVarRef(input.stroke))
      ? ({
          ...input,
          fill: resolvePaint(input.fill, lookup),
          stroke: resolvePaint(input.stroke, lookup),
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
    const strokeBounds = expandBounds(
      bounds,
      shape.strokeWidth * STROKE_MITER_LIMIT
    );
    const acq = acquireLayer(ctx, deviceBounds(ctx, strokeBounds));
    if (!acq) return;
    const layer = acq;
    const { lctx } = layer;
    setLayerTransform(layer, ctx);
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

  // Live text has no Canvas path we can clip directly, so inside/outside
  // alignment uses a tight glyph-bounds alpha layer.
  const strokeBounds = expandBounds(
    bounds,
    shape.strokeWidth * STROKE_MITER_LIMIT
  );
  const acq = acquireLayer(ctx, deviceBounds(ctx, strokeBounds));
  if (!acq) return;
  const layer = acq;
  const { lctx } = layer;
  setLayerTransform(layer, ctx);
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
    layerBounds: new Map(),
    cullExemptIds,
    stats: { paintedNodes: 0, culledNodes: 0 },
    cullingDisabled: renderCullingDisabled,
  };
  const debugProfile = renderProfilingEnabled;
  const collectPerformance = debugProfile || !!opts.onPerformanceSample;
  const layerCounter = { calls: 0, pixels: 0 };
  const startedAt =
    collectPerformance && typeof performance !== "undefined"
      ? performance.now()
      : 0;

  const base = opts.rootBaseMatrix;
  // Focus can stand inside a symbol definition, where a `var` paint may name
  // one of that symbol's parameters; painting the roots directly (no instance)
  // resolves those against the definition's own defaults.
  const roots = opts.rootIds ?? doc.rootIds;
  const rootScope = scopeForNode(doc, roots[0] ?? null);
  const paintRoots = () => {
    // Roots carry only a parent-relative transform, so painting a focused
    // container starts from its parent's world matrix. Everything else in the
    // pipeline (culling, layer bounds, effects) is already world-space and
    // therefore needs no adjustment.
    if (base) {
      ctx.save();
      ctx.transform(base[0], base[1], base[2], base[3], base[4], base[5]);
    }
    for (const nodeId of roots) {
      paintNodeInternal(
        ctx,
        doc,
        nodeId,
        opts.preview,
        opts.hiddenShapeId,
        undefined,
        opts.editorChrome,
        traversal,
        rootScope
      );
    }
    if (base) ctx.restore();
    // A preview that shares a document shape's id supersedes it (the pen
    // extending an existing path); skip the stale copy underneath. A preview
    // with no document node is a shape being drawn, whose geometry the tools
    // build in world space — so it is painted outside `base`.
    if (opts.preview && !doc.nodes[opts.preview.id]) {
      paintShape(ctx, opts.preview, doc.assets, doc, opts.preview, opts.preview, rootScope);
    }
  };
  if (collectPerformance) withLayerStats(layerCounter, paintRoots);
  else paintRoots();

  if (collectPerformance) {
    const endedAt =
      typeof performance !== "undefined" ? performance.now() : startedAt;
    const sample: RenderPerformanceSample = {
      paintNodeMs: endedAt - startedAt,
      acquireLayerCalls: layerCounter.calls,
      acquiredLayerPixels: layerCounter.pixels,
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
