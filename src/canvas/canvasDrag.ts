// Shared bits for placing library items (assets, symbols) onto the canvas,
// used by the panels that originate the drag/click and by the canvas that
// receives the drop.

import { screenToWorld } from "../model/viewport";
import type { Vec2 } from "../model/types";
import { useEditor } from "../store/editorStore";

/**
 * The canvas center in world space plus a viewport-relative box to fit placed
 * content into, mirroring what a file drop uses. Drives the panels' "place"
 * buttons so a click lands the item in view at a sensible size.
 */
export function canvasCenterPlacement(): {
  at: Vec2;
  fitWithin: { width: number; height: number };
} {
  const { viewport } = useEditor.getState();
  const rect = document.querySelector(".canvas-wrap")?.getBoundingClientRect();
  const width = rect?.width ?? window.innerWidth;
  const height = rect?.height ?? window.innerHeight;
  return {
    at: screenToWorld(viewport, { x: width / 2, y: height / 2 }),
    fitWithin: {
      width: (width / viewport.scale) * 0.8,
      height: (height / viewport.scale) * 0.8,
    },
  };
}

/**
 * Placement for an item dropped at a screen point (client coordinates), used by
 * the pointer-based panel → canvas drag. Returns null when the point isn't over
 * the canvas, so a drop elsewhere is ignored.
 */
export function canvasDropPlacement(
  clientX: number,
  clientY: number
): { at: Vec2; fitWithin: { width: number; height: number } } | null {
  const canvas = document.querySelector<HTMLCanvasElement>(".canvas-wrap canvas");
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const { viewport } = useEditor.getState();
  return {
    at: screenToWorld(viewport, {
      x: clientX - rect.left,
      y: clientY - rect.top,
    }),
    fitWithin: {
      width: (rect.width / viewport.scale) * 0.8,
      height: (rect.height / viewport.scale) * 0.8,
    },
  };
}
