import { rotateAbout } from "./rotate";
import type { Matrix, Bounds, Vec2 } from "../types";

/**
 * Viewport maps world coordinates to screen pixels:
 *   screen = R(rotation) * scale * F * world + offset
 * `offset` is in screen pixels, `scale` is uniform zoom and `rotation` is the
 * canvas orientation in radians (clockwise, since screen y points down).
 * `flipX` mirrors the view horizontally (F = diag(-1, 1)) without touching the
 * document — a display-only left/right flip.
 */
export interface Viewport {
  scale: number;
  rotation: number;
  offset: Vec2;
  flipX?: boolean;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const initialViewport: Viewport = {
  scale: 1,
  rotation: 0,
  offset: { x: 0, y: 0 },
};

export function worldToScreen(v: Viewport, p: Vec2): Vec2 {
  const sx = v.flipX ? -1 : 1;
  const c = Math.cos(v.rotation) * v.scale;
  const s = Math.sin(v.rotation) * v.scale;
  return {
    x: c * sx * p.x - s * p.y + v.offset.x,
    y: s * sx * p.x + c * p.y + v.offset.y,
  };
}

export function screenToWorld(v: Viewport, p: Vec2): Vec2 {
  const sx = v.flipX ? -1 : 1;
  const c = Math.cos(v.rotation) * v.scale;
  const s = Math.sin(v.rotation) * v.scale;
  const det = c * c + s * s || 1;
  const dx = p.x - v.offset.x;
  const dy = p.y - v.offset.y;
  return { x: (sx * (c * dx + s * dy)) / det, y: (-s * dx + c * dy) / det };
}

/** The world->screen affine as a [a,b,c,d,e,f] matrix (e.g. for CSS overlays). */
export function viewportMatrix(v: Viewport): Matrix {
  const sx = v.flipX ? -1 : 1;
  const c = Math.cos(v.rotation) * v.scale;
  const s = Math.sin(v.rotation) * v.scale;
  return [c * sx, s * sx, -s, c, v.offset.x, v.offset.y];
}

/** Zoom around a fixed screen anchor point (keeps that point stationary). */
export function zoomAt(v: Viewport, anchor: Vec2, factor: number): Viewport {
  const newScale = clampScale(v.scale * factor);
  const realFactor = newScale / v.scale;
  return {
    scale: newScale,
    rotation: v.rotation,
    flipX: v.flipX,
    offset: {
      x: anchor.x - (anchor.x - v.offset.x) * realFactor,
      y: anchor.y - (anchor.y - v.offset.y) * realFactor,
    },
  };
}

/**
 * Mirror the displayed image left/right around a vertical screen line through
 * `anchor` (which stays fixed). A display-only flip; the document is untouched.
 * A screen-space horizontal mirror decomposes into toggling `flipX`, negating
 * the rotation and reflecting `offset.x`, so it stays exact under any canvas
 * rotation.
 */
export function flipAt(v: Viewport, anchor: Vec2): Viewport {
  return {
    scale: v.scale,
    rotation: -v.rotation,
    flipX: !v.flipX,
    offset: { x: 2 * anchor.x - v.offset.x, y: v.offset.y },
  };
}

/**
 * Snap an angle (radians) to the nearest quarter turn when it is within
 * `threshold` of one; otherwise return it unchanged. Used for canvas rotation
 * so a free twist clicks into the cardinal orientations.
 */
export function snapAngleToQuarter(
  angle: number,
  threshold = (7 * Math.PI) / 180
): number {
  const step = Math.PI / 2;
  const nearest = Math.round(angle / step) * step;
  return Math.abs(angle - nearest) <= threshold ? nearest : angle;
}

/** Rotate the canvas around a fixed screen anchor point (keeps it stationary). */
export function rotateAt(v: Viewport, anchor: Vec2, delta: number): Viewport {
  return {
    scale: v.scale,
    rotation: v.rotation + delta,
    flipX: v.flipX,
    offset: rotateAbout(anchor, v.offset, delta),
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
    rotation: 0,
    offset: {
      x: screenWidth / 2 - (x + width / 2) * scale,
      y: screenHeight / 2 - (y + height / 2) * scale,
    },
  };
}

export function clampScale(s: number): number {
  return Math.max(0.05, Math.min(64, s));
}
