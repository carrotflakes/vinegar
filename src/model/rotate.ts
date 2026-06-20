import type { Vec2 } from "./types";

/** Rotate point `p` by `angle` radians around the origin. */
export function rotateVec(p: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Rotate point `p` by `angle` radians around `pivot`. */
export function rotateAbout(pivot: Vec2, p: Vec2, angle: number): Vec2 {
  const d = rotateVec({ x: p.x - pivot.x, y: p.y - pivot.y }, angle);
  return { x: pivot.x + d.x, y: pivot.y + d.y };
}

/** Snap an angle (radians) to the nearest `stepDeg` degrees. */
export function snapAngle(angle: number, stepDeg = 15): number {
  const step = (stepDeg * Math.PI) / 180;
  return Math.round(angle / step) * step;
}
