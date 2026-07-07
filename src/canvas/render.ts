import { bezierSegments } from "../model/bezier";
import { shapeBounds, shapeCenter } from "../model/bounds";
import type { Document, Shape } from "../model/types";
import { worldToScreen, type Viewport } from "../model/viewport";

/** Build the geometry of a shape onto the current canvas path. */
function tracePath(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.beginPath();
  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      ctx.rect(b.x, b.y, b.width, b.height);
      break;
    }
    case "ellipse": {
      const b = shapeBounds(shape);
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
      const segs = bezierSegments(shape);
      if (segs.length === 0) {
        if (shape.anchors[0]) {
          const p = shape.anchors[0].p;
          ctx.moveTo(p.x, p.y);
        }
        break;
      }
      ctx.moveTo(segs[0].p0.x, segs[0].p0.y);
      for (const s of segs) {
        ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p1.x, s.p1.y);
      }
      if (shape.closed) ctx.closePath();
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
  }
}

/** Paint one shape (fill then stroke) in world coordinates. */
export function paintShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.save();
  ctx.globalAlpha = shape.opacity;
  if (shape.rotation) {
    const c = shapeCenter(shape);
    ctx.translate(c.x, c.y);
    ctx.rotate(shape.rotation);
    ctx.translate(-c.x, -c.y);
  }
  tracePath(ctx, shape);

  // Lines and open paths/curves are never filled.
  const fillable =
    shape.fill !== null &&
    shape.type !== "line" &&
    !(shape.type === "path" && !shape.closed) &&
    !(shape.type === "bezier" && !shape.closed);
  if (fillable) {
    ctx.fillStyle = shape.fill as string;
    ctx.fill(shape.type === "polygon" ? "evenodd" : "nonzero");
  }
  if (shape.stroke !== null && shape.strokeWidth > 0) {
    ctx.strokeStyle = shape.stroke;
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

  for (const id of doc.order) {
    // A preview that shares a document shape's id supersedes it (the pen
    // extending an existing path); skip the stale copy underneath.
    if (opts.preview && id === opts.preview.id) continue;
    const shape = doc.shapes[id];
    if (shape && !shape.hidden) paintShape(ctx, shape);
  }
  if (opts.preview) paintShape(ctx, opts.preview);

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
