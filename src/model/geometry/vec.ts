import type { Vec2 } from "../types";

/**
 * Point/vector arithmetic. `Vec2` doubles as both — the model stores plain
 * `{ x, y }` objects everywhere — so these are the shared spellings of the
 * handful of operations that were otherwise re-declared per module.
 */

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v: Vec2, k: number): Vec2 => ({ x: v.x * k, y: v.y * k });

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const length = (v: Vec2): number => Math.hypot(v.x, v.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The unit vector, or `null` when there is no direction to speak of. */
export function normalize(v: Vec2): Vec2 | null {
  const size = length(v);
  return size > 1e-12 ? { x: v.x / size, y: v.y / size } : null;
}

/** Coordinate equality with a tolerance, for "is this handle on its anchor". */
export const samePoint = (a: Vec2, b: Vec2, epsilon = 1e-9): boolean =>
  Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
