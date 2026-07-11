import type { Bounds, Vec2 } from "../model/types";

/** Status-bar readout for a size, e.g. "120 × 80". */
export function formatSize(width: number, height: number): string {
  return `${Math.round(Math.abs(width))} × ${Math.round(Math.abs(height))}`;
}

/** Status-bar readout for an angle in radians, normalized to (-180°, 180°]. */
export function formatAngle(rad: number): string {
  let deg = (rad * 180) / Math.PI;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (deg === -180) deg = 180;
  return `${Math.round(deg * 10) / 10}°`;
}

/** Snap point b onto the nearest 45° ray from a (for Shift-constrained lines). */
export function constrain45(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return b;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

export function boundsFromPoints(a: Vec2, b: Vec2): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}
