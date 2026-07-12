import { subpathSegments } from "../model/bezier";
import { shapeBounds } from "../model/bounds";
import { isIdentity } from "../model/matrix";
import { resolvePaint } from "../model/paint";
import { isGroup, isInstance, isShape } from "../model/scene";
import type { Artboard, Document, Shape } from "../model/types";
import { worldToScreen, type Viewport } from "../model/viewport";

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
  activeSymbols: Set<string> = new Set()
): void {
  const node = doc.nodes[nodeId];
  if (!node) return;
  if (isShape(node)) {
    if (node.hidden) return;
    paintShape(ctx, preview?.id === node.id ? preview : node);
    return;
  }
  let childIds: string[];
  let symbolId: string | null = null;
  if (isGroup(node)) {
    childIds = node.childIds;
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
  const alpha = node.opacity ?? 1;
  const blend = node.blendMode && node.blendMode !== "normal" ? node.blendMode : null;
  if (alpha >= 1 && !blend) {
    for (const childId of childIds) paintNode(ctx, doc, childId, preview, activeSymbols);
    ctx.restore();
    if (symbolId) activeSymbols.delete(symbolId);
    return;
  }
  const layer = document.createElement("canvas");
  layer.width = ctx.canvas.width;
  layer.height = ctx.canvas.height;
  const lctx = layer.getContext("2d");
  if (!lctx) {
    ctx.restore();
    if (symbolId) activeSymbols.delete(symbolId);
    return;
  }
  lctx.setTransform(ctx.getTransform());
  for (const childId of childIds) paintNode(lctx, doc, childId, preview, activeSymbols);
  ctx.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (blend) ctx.globalCompositeOperation = blend;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
  if (symbolId) activeSymbols.delete(symbolId);
}

/** Build the geometry of a shape onto the current canvas path. */
function tracePath(ctx: CanvasRenderingContext2D, shape: Shape, begin = true): void {
  if (begin) ctx.beginPath();
  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      ctx.rect(b.x, b.y, b.width, b.height);
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
  }
}

/** Paint one shape (fill then stroke) in world coordinates. */
export function paintShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.save();
  ctx.globalAlpha = shape.opacity;
  if (shape.blendMode && shape.blendMode !== "normal") {
    ctx.globalCompositeOperation = shape.blendMode;
  }
  if (!isIdentity(shape.transform)) ctx.transform(...shape.transform);
  tracePath(ctx, shape);

  // Lines and open paths/curves are never filled.
  const fillable =
    shape.fill !== null &&
    shape.type !== "line" &&
    !(shape.type === "path" && !shape.closed) &&
    !(shape.type === "bezier" && !shape.subpaths.some((sp) => sp.closed));
  if (fillable && shape.fill) {
    ctx.fillStyle = resolvePaint(ctx, shape.fill, shapeBounds(shape));
    ctx.fill(
      shape.type === "polygon" || shape.type === "compoundPath"
        ? "evenodd"
        : "nonzero"
    );
  }
  if (shape.stroke !== null && shape.strokeWidth > 0) {
    ctx.strokeStyle = resolvePaint(ctx, shape.stroke, shapeBounds(shape));
    ctx.lineWidth = shape.strokeWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();
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
    paintNode(ctx, doc, nodeId, opts.preview);
  }
  if (opts.preview && !doc.nodes[opts.preview.id]) paintShape(ctx, opts.preview);

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
