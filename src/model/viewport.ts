import type { Vec2 } from "./types";

/**
 * Viewport maps world coordinates to screen pixels:
 *   screen = world * scale + offset
 * `offset` is in screen pixels, `scale` is uniform zoom.
 */
export interface Viewport {
  scale: number;
  offset: Vec2;
}

export const initialViewport: Viewport = {
  scale: 1,
  offset: { x: 0, y: 0 },
};

export function worldToScreen(v: Viewport, p: Vec2): Vec2 {
  return { x: p.x * v.scale + v.offset.x, y: p.y * v.scale + v.offset.y };
}

export function screenToWorld(v: Viewport, p: Vec2): Vec2 {
  return { x: (p.x - v.offset.x) / v.scale, y: (p.y - v.offset.y) / v.scale };
}

/** Zoom around a fixed screen anchor point (keeps that point stationary). */
export function zoomAt(v: Viewport, anchor: Vec2, factor: number): Viewport {
  const newScale = clampScale(v.scale * factor);
  const realFactor = newScale / v.scale;
  return {
    scale: newScale,
    offset: {
      x: anchor.x - (anchor.x - v.offset.x) * realFactor,
      y: anchor.y - (anchor.y - v.offset.y) * realFactor,
    },
  };
}

export function clampScale(s: number): number {
  return Math.max(0.05, Math.min(64, s));
}
