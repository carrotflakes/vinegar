import type { Bounds, Vec2 } from "./types";

/**
 * Viewport maps world coordinates to screen pixels:
 *   screen = world * scale + offset
 * `offset` is in screen pixels, `scale` is uniform zoom.
 */
export interface Viewport {
  scale: number;
  offset: Vec2;
}

export interface ViewportSize {
  width: number;
  height: number;
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

/**
 * Build a viewport that centres `bounds` inside a screen-space rectangle.
 * Zero-width/height bounds (lines and points) ignore that axis when choosing
 * the scale, while still being centred on both axes.
 */
export function fitBoundsInViewport(
  bounds: Bounds,
  size: ViewportSize,
  padding = 48
): Viewport {
  const screenWidth = Math.max(1, size.width);
  const screenHeight = Math.max(1, size.height);
  const inset = Math.max(0, padding);
  const availableWidth = Math.max(1, screenWidth - inset * 2);
  const availableHeight = Math.max(1, screenHeight - inset * 2);

  // Be tolerant of a non-normalized bounds object even though model bounds are
  // normally positive-sized.
  const x = bounds.width < 0 ? bounds.x + bounds.width : bounds.x;
  const y = bounds.height < 0 ? bounds.y + bounds.height : bounds.y;
  const width = Math.abs(bounds.width);
  const height = Math.abs(bounds.height);
  const candidates: number[] = [];
  if (width > 0) candidates.push(availableWidth / width);
  if (height > 0) candidates.push(availableHeight / height);
  const scale = clampScale(candidates.length ? Math.min(...candidates) : 1);

  return {
    scale,
    offset: {
      x: screenWidth / 2 - (x + width / 2) * scale,
      y: screenHeight / 2 - (y + height / 2) * scale,
    },
  };
}

export function clampScale(s: number): number {
  return Math.max(0.05, Math.min(64, s));
}
