import { screenToWorld, worldToScreen } from "@/model/geometry/viewport";
import type { RenderOptions } from "./types";

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

export function drawGrid(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
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
