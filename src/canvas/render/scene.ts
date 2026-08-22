import {
  expandBounds,
  intersectBounds,
  shapeBounds,
} from "@/model/geometry/bounds";
import { isIdentity, transformBounds } from "@/model/geometry/matrix";
import { cachedBrushEnvelope } from "@/model/brush/brushOutline";
import { hasVectorGeometry, shapeFillRule } from "@/model/path/shapeGeometry";
import {
  activeEffects,
  effectsMargin,
  hasEffects,
  isGeometryEffect,
  needsEffectIsolation,
  paintsGeometryEffects,
  pixelEffects,
  strokeEffectOutset,
} from "@/model/effects";
import { hasMarkers, strokeEndContours } from "@/model/marker";
import { isSwatchRef, resolvePaintRef, type Paint } from "@/model/paint";
import { ancestorIds, isShape } from "@/model/scene";
import { containerChildIds, containerContents } from "@/model/sceneWalk";
import {
  effectiveStrokeAlignment,
  strokeOutset,
  STROKE_MITER_LIMIT,
  supportsStrokeAlignment,
} from "@/model/stroke";
import type {
  Bounds,
  Document,
  DocumentAsset,
  FrameNode,
  GeometryEffect,
  ImageShape,
  Shape,
  StrokeAlignment,
} from "@/model/types";
import { getAssetImage } from "@/imageCache";
import { layoutTextInBrowser, textFontCss, type TextLineLayout } from "@/model/text/layout";
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
import { cachedShapePath, traceSubpaths, tracePath } from "./path";
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
 * Does anything under `ids` composite with a non-normal blend mode?
 *
 * A masked group that contains one cannot apply its mask as a path clip: an
 * advanced blend made under a large path clip is dropped whole by Chrome on
 * Android once the clip's device bounds pass the driver's limit (zooming in on
 * the demo document's clipped "MASKED" text made it vanish). Such a group
 * isolates instead and applies its mask as alpha, so the blend runs unclipped.
 *
 * Blend modes on *effects* are excluded: those composite inside the node's own
 * isolation layer, below any clip.
 */
function subtreeBlends(
  doc: Document,
  ids: string[],
  visiting: Set<string> = new Set()
): boolean {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node || node.hidden || visiting.has(id)) continue;
    visiting.add(id);
    if (node.blendMode && node.blendMode !== "normal") return true;
    // A clipping mask is not painted, so its own blend mode cannot force the
    // group onto a layer — `containerContents` leaves it out of `childIds`.
    const childIds = containerChildIds(doc, node);
    if (childIds.length && subtreeBlends(doc, childIds, visiting)) return true;
  }
  return false;
}

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
    // An image or live text has no outline for a fill/stroke effect to paint,
    // so those entries drop out here rather than costing an isolation layer.
    const effects = paintsGeometryEffects(shape, doc)
      ? activeEffects(shape.effects)
      : pixelEffects(shape.effects);
    if (!hasEffects(effects)) {
      paintShape(ctx, shape, doc.assets, doc, preview);
      return;
    }
    // A stack that only adds paint, on a node that composites plainly, needs no
    // isolation: paint the content and then each pass straight onto the target.
    // Opacity and blend mode are excluded because they composite the finished
    // stack as one group — which is also what SVG export does with them, so
    // taking the direct route there would make the two disagree.
    if (
      !needsEffectIsolation(effects) &&
      shape.opacity >= 1 &&
      (!shape.blendMode || shape.blendMode === "normal")
    ) {
      paintShape(ctx, shape, doc.assets, doc, preview);
      for (const effect of effects) {
        if (isGeometryEffect(effect)) {
          paintGeometryEffect(ctx, shape, effect, doc.assets, doc, preview);
        }
      }
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
            effectsMargin(effects) * effectScale
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
      shape
    );
    compositeEffects(
      ctx,
      layer,
      effectScale,
      effects,
      shape.opacity,
      shape.blendMode,
      // A fill/stroke effect paints the shape's own outline into whichever
      // layer the stack has reached, so it needs that layer put back into the
      // shape's world space first.
      (target, effect) => {
        setLayerTransform(target, ctx);
        paintGeometryEffect(
          target.lctx,
          shape,
          effect,
          doc.assets,
          doc,
          preview
        );
      }
    );
    return;
  }
  const contents = containerContents(doc, node, activeSymbols);
  if (!contents) return;
  const { childIds } = contents;
  const mask: Shape | null =
    contents.kind === "group" ? contents.mask : null;
  const frame: FrameNode | null =
    contents.kind === "frame" ? contents.frame : null;
  const symbolId = contents.kind === "instance" ? contents.symbolId : null;
  if (node.hidden) return;
  if (symbolId) activeSymbols.add(symbolId);
  // See `subtreeBlends`: with a blend under it, the mask becomes an alpha pass
  // on the group's own layer instead of a clip on the target.
  const maskAsAlpha = !!mask && subtreeBlends(doc, childIds);
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
    if (!mask || maskAsAlpha) return;
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
  /** The mask as a `destination-in` alpha pass over a layer holding the group's
   *  finished content — the clip-free counterpart of `applyMask`. */
  const paintMaskAlpha = (target: CanvasRenderingContext2D) => {
    if (!mask) return;
    const geometry = preview?.id === mask.id ? preview : mask;
    const path = cachedShapePath(geometry, doc, preview);
    target.save();
    target.globalCompositeOperation = "destination-in";
    target.globalAlpha = 1;
    target.fillStyle = "#000";
    target.transform(...geometry.transform);
    if (path) {
      target.fill(path, shapeFillRule(geometry));
    } else {
      tracePath(target, geometry, true, doc, preview);
      target.fill(shapeFillRule(geometry));
    }
    target.restore();
  };
  const alpha = node.opacity ?? 1;
  const blend = node.blendMode && node.blendMode !== "normal" ? node.blendMode : null;
  // A container has no outline, so fill/stroke entries in its stack do nothing —
  // and an empty run of them must not cost it an isolation layer.
  const containerEffects = pixelEffects(node.effects);
  const effects = hasEffects(containerEffects) ? containerEffects : null;
  if (alpha >= 1 && !blend && !effects && !maskAsAlpha) {
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
      childTraversal
    );
  }
  if (maskAsAlpha) paintMaskAlpha(lctx);
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
    editorChrome
  );
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
  // With outlines, text is ordinary filled geometry and falls through to the
  // shared fill/stroke pass below, which is what gives it real stroke alignment
  // and geometry effects. Without them (a system font, or a font still loading)
  // the browser draws the glyphs. The question is asked of the geometry source,
  // not of the swatch-resolved clone, so the outline cache keeps hitting.
  if (shape.type === "text" && !hasVectorGeometry(geometrySource, doc)) {
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
    paintMarkers(ctx, shape, bounds, assets);
  }
  ctx.restore();
}

/**
 * Paint the end markers of an open shape, over the stroke and with the same
 * paint. Markers are ordinary contours in the shape's local space, so they need
 * no transform of their own — which is what keeps a user-space gradient
 * continuous across line and arrowhead.
 */
function paintMarkers(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  bounds: Bounds,
  assets: Record<string, DocumentAsset>
): void {
  if (!shape.stroke || !hasMarkers(shape)) return;
  const contours = strokeEndContours(shape);
  if (!contours.length) return;
  const style = resolveStyle(ctx, shape.stroke, bounds, assets, strokeOutset(shape));
  // A null style is a pattern still decoding; skip until the cache repaints.
  if (!style) return;
  withPaintAlpha(ctx, shape.opacity, shape.stroke, () => {
    ctx.save();
    applyStrokeStyle(ctx, shape, shape.strokeWidth);
    // A dash pattern belongs to the line, never to the mark on its end.
    if (typeof ctx.setLineDash === "function") ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    // The corners belong to the marker's own artwork, not to the line: a miter
    // would spike an arrow's vertex past the end point it is meant to sit on.
    ctx.lineJoin = "round";
    // …but the marker's open ends (an arrow's tails, a bar) keep the line's cap.
    ctx.lineCap = shape.strokeCap;
    ctx.fillStyle = style;
    ctx.strokeStyle = style;
    for (const contour of contours) {
      traceSubpaths(ctx, [contour.subpath]);
      if (contour.filled) ctx.fill("nonzero");
      else ctx.stroke();
    }
    ctx.restore();
  });
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
  const layout = layoutTextInBrowser(shape);
  const bounds = shapeBounds(shape);
  // The same font the layout was measured with, for `fillText`/`strokeText`
  // below and for the stroke's offscreen layer.
  ctx.font = textFontCss(shape);
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

/** One pen pass along a shape's geometry, whatever it came from. */
interface StrokePass {
  paint: Paint;
  width: number;
  alignment: StrokeAlignment;
  /** How far the pen reaches past the geometry; lays out gradients/patterns. */
  outset: number;
  /** Node opacity a pattern's own alpha folds into. */
  opacity: number;
  /** Sets lineWidth / cap / join / dash for one pass at the given width. */
  applyLineStyle: (target: CanvasRenderingContext2D, width: number) => void;
}

/**
 * Stroke a shape's geometry with one pass, honouring inside/outside alignment.
 * SVG-style alignment does not exist in Canvas, so both off-centre cases stroke
 * at double width and cut the wrong half away — inside by clipping to the
 * silhouette, outside by punching it out of a temporary layer. The shape's own
 * stroke and every stroke effect share this so they can never drift apart.
 */
function strokeShapeGeometry(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  pass: StrokePass,
  bounds: Bounds,
  assets: Record<string, DocumentAsset>,
  path: Path2D | null,
  doc?: Document,
  preview?: Shape | null
): void {
  if (pass.alignment === "outside") {
    const strokeBounds = expandBounds(bounds, pass.width * STROKE_MITER_LIMIT);
    const acq = acquireLayer(ctx, deviceBounds(ctx, strokeBounds));
    if (!acq) return;
    const layer = acq;
    const { lctx } = layer;
    setLayerTransform(layer, ctx);
    const style = resolveStyle(lctx, pass.paint, bounds, assets, pass.outset);
    if (!style) {
      releaseLayer(layer);
      return;
    }
    lctx.strokeStyle = style;
    pass.applyLineStyle(lctx, pass.width * 2);
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
    withPaintAlpha(ctx, pass.opacity, pass.paint, () =>
      drawLayerInDeviceSpace(ctx, layer)
    );
    releaseLayer(layer);
    return;
  }

  const style = resolveStyle(ctx, pass.paint, bounds, assets, pass.outset);
  if (!style) return;
  withPaintAlpha(ctx, pass.opacity, pass.paint, () => {
    ctx.save();
    if (pass.alignment === "inside") {
      if (path) ctx.clip(path, shapeFillRule(shape));
      else {
        tracePath(ctx, shape, true, doc, preview);
        ctx.clip(shapeFillRule(shape));
        tracePath(ctx, shape, true, doc, preview);
      }
    }
    ctx.strokeStyle = style;
    pass.applyLineStyle(
      ctx,
      pass.alignment === "inside" ? pass.width * 2 : pass.width
    );
    if (path) ctx.stroke(path);
    else ctx.stroke();
    ctx.restore();
  });
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
  strokeShapeGeometry(
    ctx,
    shape,
    {
      paint: shape.stroke,
      width: shape.strokeWidth,
      alignment: effectiveStrokeAlignment(shape),
      outset: strokeOutset(shape),
      opacity: shape.opacity,
      applyLineStyle: (target, width) => applyStrokeStyle(target, shape, width),
    },
    bounds,
    assets,
    path,
    doc,
    preview
  );
}

/**
 * Paint one geometry effect (an extra fill or stroke along the node's own
 * outline) onto a layer that already holds everything below it in the stack.
 * Works in the shape's local space, exactly like `paintShape` — the effect's
 * lengths are local units, so they scale with the node's transform chain.
 */
export function paintGeometryEffect(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  effect: GeometryEffect,
  assets: Record<string, DocumentAsset> = {},
  doc?: Document,
  preview?: Shape | null
): void {
  if (!paintsGeometryEffects(shape, doc)) return;
  const paint = resolvePaintRef(effect.paint, doc?.swatches ?? {});
  if (!paint) return;
  ctx.save();
  // The layer in hand may carry a preceding pixel effect's filter and the
  // caller's compositing state; only the effect's own blend mode survives.
  ctx.filter = "none";
  ctx.globalCompositeOperation =
    effect.blendMode === "normal"
      ? "source-over"
      : (effect.blendMode as GlobalCompositeOperation);
  ctx.globalAlpha = 1;
  if (!isIdentity(shape.transform)) ctx.transform(...shape.transform);
  const path = cachedShapePath(shape, doc, preview);
  const bounds = shapeBounds(shape, doc);
  if (effect.type === "fill") {
    const style = resolveStyle(ctx, paint, bounds, assets);
    // A null style is a pattern still decoding; skip until the cache repaints.
    if (style) {
      withPaintAlpha(ctx, 1, paint, () => {
        ctx.fillStyle = style;
        if (path) ctx.fill(path, shapeFillRule(shape));
        else {
          tracePath(ctx, shape, true, doc, preview);
          ctx.fill(shapeFillRule(shape));
        }
      });
    }
  } else if (effect.width > 0) {
    strokeShapeGeometry(
      ctx,
      shape,
      {
        paint,
        width: effect.width,
        // Inside/outside is meaningless on open geometry, as for a shape's own
        // stroke (`effectiveStrokeAlignment`).
        alignment: supportsStrokeAlignment(shape) ? effect.alignment : "center",
        outset: strokeEffectOutset(effect),
        opacity: 1,
        applyLineStyle: (target, width) => {
          target.lineWidth = width;
          target.lineCap = effect.cap;
          target.lineJoin = effect.join;
          target.miterLimit = STROKE_MITER_LIMIT;
          // The dash pattern belongs to the shape's own stroke, not to an
          // effect drawn along the same outline.
          if (typeof target.setLineDash === "function") target.setLineDash([]);
          target.lineDashOffset = 0;
        },
      },
      bounds,
      assets,
      path,
      doc,
      preview
    );
  }
  ctx.restore();
}

function paintTextStroke(
  ctx: CanvasRenderingContext2D,
  shape: Extract<Shape, { type: "text" }>,
  lines: TextLineLayout[],
  bounds: Bounds,
  assets: Record<string, DocumentAsset>
): void {
  if (!shape.stroke) return;
  const alignment = effectiveStrokeAlignment(shape);
  if (alignment === "center") {
    const style = resolveStyle(ctx, shape.stroke, bounds, assets, strokeOutset(shape));
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
  const style = resolveStyle(lctx, shape.stroke, bounds, assets, strokeOutset(shape));
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
  const paintRoots = () => {
    // Roots carry only a parent-relative transform, so painting a focused
    // container starts from its parent's world matrix. Everything else in the
    // pipeline (culling, layer bounds, effects) is already world-space and
    // therefore needs no adjustment.
    if (base) {
      ctx.save();
      ctx.transform(base[0], base[1], base[2], base[3], base[4], base[5]);
    }
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
    if (base) ctx.restore();
    // A preview that shares a document shape's id supersedes it (the pen
    // extending an existing path); skip the stale copy underneath. A preview
    // with no document node is a shape being drawn, whose geometry the tools
    // build in world space — so it is painted outside `base`.
    if (opts.preview && !doc.nodes[opts.preview.id]) {
      paintShape(ctx, opts.preview, doc.assets, doc, opts.preview);
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
