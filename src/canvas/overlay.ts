import type { Bounds } from "../model/types";
import { worldToScreen, type Viewport } from "../model/viewport";
import { HANDLE_IDS, HANDLE_SIZE, handlePoint } from "./handles";

const ACCENT = "#3b82f6";

export interface OverlayOptions {
  dpr: number;
  viewport: Viewport;
  /** World-space bounds of the current selection, if any. */
  selectionBounds: Bounds | null;
  /** Screen-space marquee rect, if a selection drag is active. */
  marquee: Bounds | null;
  /** Whether handles should be drawn (single shape / scalable selection). */
  showHandles: boolean;
}

/** Draw selection chrome on top of the rendered scene, in screen space. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  opts: OverlayOptions
): void {
  const { dpr, viewport, selectionBounds, marquee } = opts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (selectionBounds) {
    const tl = worldToScreen(viewport, {
      x: selectionBounds.x,
      y: selectionBounds.y,
    });
    const br = worldToScreen(viewport, {
      x: selectionBounds.x + selectionBounds.width,
      y: selectionBounds.y + selectionBounds.height,
    });

    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.setLineDash([]);

    if (opts.showHandles) {
      const half = HANDLE_SIZE / 2;
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      for (const id of HANDLE_IDS) {
        const wp = handlePoint(selectionBounds, id);
        const sp = worldToScreen(viewport, wp);
        ctx.beginPath();
        ctx.rect(
          Math.round(sp.x - half),
          Math.round(sp.y - half),
          HANDLE_SIZE,
          HANDLE_SIZE
        );
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  if (marquee) {
    ctx.fillStyle = "rgba(59,130,246,0.12)";
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height);
    ctx.strokeRect(
      marquee.x + 0.5,
      marquee.y + 0.5,
      marquee.width,
      marquee.height
    );
  }
}
