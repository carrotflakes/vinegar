import type { BezierSubpath, Vec2 } from "../../model/types";

/**
 * Draw generator geometry into a preview canvas, fitted and centered. All
 * subpaths share one path so the nonzero fill cuts holes (e.g. a gear's
 * center), matching how the canvas renders a bezier node.
 */
export function drawGeometryPreview(
  canvas: HTMLCanvasElement | null,
  subpaths: BezierSubpath[] | null
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

  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const pad = 14;
  const scale = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
  const ox = (w - bw * scale) / 2 - minX * scale;
  const oy = (h - bh * scale) / 2 - minY * scale;
  const T = (p: Vec2): Vec2 => ({ x: p.x * scale + ox, y: p.y * scale + oy });

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
