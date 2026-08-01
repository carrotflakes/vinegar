import type { PathSubpath, Vec2 } from "../../model/types";
import { readCanvasTheme } from "../../canvas/canvasTheme";

const GRID_MAJOR_EVERY = 5;
const GRID_TARGET_PX = 40;

/** Choose a readable world-space grid interval from the 1, 2, 5 sequence. */
export function previewGridStep(scale: number): number {
  const target = GRID_TARGET_PX / scale;
  const power = 10 ** Math.floor(Math.log10(target));
  const normalized = target / power;
  const multiple = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiple * power;
}

function formatGridStep(step: number): string {
  if (step >= 1) return step.toLocaleString("en-US");
  return step.toLocaleString("en-US", {
    maximumFractionDigits: Math.max(0, -Math.floor(Math.log10(step))),
  });
}

function drawPreviewGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  offsetX: number,
  offsetY: number
): void {
  const theme = readCanvasTheme();
  const worldStep = previewGridStep(scale);
  const screenStep = worldStep * scale;
  const minColumn = Math.ceil(-offsetX / screenStep);
  const maxColumn = Math.floor((width - offsetX) / screenStep);
  const minRow = Math.ceil(-offsetY / screenStep);
  const maxRow = Math.floor((height - offsetY) / screenStep);

  ctx.save();
  ctx.lineWidth = 1;
  for (let column = minColumn; column <= maxColumn; column++) {
    const x = Math.round(offsetX + column * screenStep) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.strokeStyle =
      column === 0
        ? theme.grid.axis
        : column % GRID_MAJOR_EVERY === 0
          ? theme.grid.major
          : theme.grid.minor;
    ctx.stroke();
  }
  for (let row = minRow; row <= maxRow; row++) {
    const y = Math.round(offsetY + row * screenStep) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.strokeStyle =
      row === 0
        ? theme.grid.axis
        : row % GRID_MAJOR_EVERY === 0
          ? theme.grid.major
          : theme.grid.minor;
    ctx.stroke();
  }

  ctx.fillStyle = theme.grid.axis;
  ctx.font = "10px system-ui, sans-serif";

  // A scale key keeps the grid meaningful even when auto-fit changes the zoom.
  const label = `${formatGridStep(worldStep)} units`;
  const labelWidth = ctx.measureText(label).width;
  const keyWidth = Math.max(labelWidth, screenStep);
  const keyX = width - keyWidth - 10;
  const labelX = keyX + (keyWidth - labelWidth) / 2;
  const lineX = keyX + (keyWidth - screenStep) / 2;
  const keyY = height - 9;
  ctx.fillText(label, labelX, keyY);
  ctx.beginPath();
  ctx.moveTo(lineX, keyY - 13.5);
  ctx.lineTo(lineX + screenStep, keyY - 13.5);
  ctx.moveTo(lineX, keyY - 16.5);
  ctx.lineTo(lineX, keyY - 10.5);
  ctx.moveTo(lineX + screenStep, keyY - 16.5);
  ctx.lineTo(lineX + screenStep, keyY - 10.5);
  ctx.strokeStyle = theme.grid.axis;
  ctx.stroke();
  ctx.restore();
}

export interface GeometryPreviewOptions {
  /** Draw the reference grid and its scale key (off for small thumbnails). */
  grid?: boolean;
  /** Empty margin around the fitted geometry, in CSS pixels. */
  pad?: number;
}

/**
 * Draw generator geometry into a preview canvas, fitted and centered. All
 * subpaths share one path so the nonzero fill cuts holes (e.g. a gear's
 * center), matching how the canvas renders a bezier node.
 *
 * With the grid on, the local origin is kept in view so the geometry's position
 * relative to it is readable; a grid-less thumbnail fits the geometry alone.
 */
export function drawGeometryPreview(
  canvas: HTMLCanvasElement | null,
  subpaths: PathSubpath[] | null,
  { grid = true, pad = 14 }: GeometryPreviewOptions = {}
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!subpaths || subpaths.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (p: Vec2) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const sp of subpaths) {
    for (const a of sp.anchors) {
      grow(a.p);
      if (a.hIn) grow(a.hIn);
      if (a.hOut) grow(a.hOut);
    }
  }
  if (!Number.isFinite(minX)) return;

  // Keep the generator's local origin visible, including for geometry that
  // lives entirely on one side of it.
  if (grid) {
    minX = Math.min(minX, 0);
    minY = Math.min(minY, 0);
    maxX = Math.max(maxX, 0);
    maxY = Math.max(maxY, 0);
  }

  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const scale = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
  const ox = (w - bw * scale) / 2 - minX * scale;
  const oy = (h - bh * scale) / 2 - minY * scale;
  const T = (p: Vec2): Vec2 => ({ x: p.x * scale + ox, y: p.y * scale + oy });

  if (grid) drawPreviewGrid(ctx, w, h, scale, ox, oy);

  ctx.beginPath();
  for (const sp of subpaths) {
    const A = sp.anchors;
    if (A.length === 0) continue;
    const start = T(A[0].p);
    ctx.moveTo(start.x, start.y);
    const segments = sp.closed ? A.length : A.length - 1;
    for (let i = 0; i < segments; i++) {
      const a = A[i];
      const b = A[(i + 1) % A.length];
      const c1 = T(a.hOut ?? a.p);
      const c2 = T(b.hIn ?? b.p);
      const p = T(b.p);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
    }
    if (sp.closed) ctx.closePath();
  }
  ctx.fillStyle = "rgba(107, 124, 255, 0.22)";
  ctx.fill("nonzero");
  ctx.strokeStyle = "#6b7cff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
