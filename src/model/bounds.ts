import { flattenBezier } from "./bezier";
import type { Bounds, Shape, Vec2 } from "./types";

function pointsBounds(points: Vec2[]): Bounds {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Normalize a rect that may have negative width/height. */
export function normalizeRect(
  x: number,
  y: number,
  w: number,
  h: number
): Bounds {
  return {
    x: w < 0 ? x + w : x,
    y: h < 0 ? y + h : y,
    width: Math.abs(w),
    height: Math.abs(h),
  };
}

/** Axis-aligned bounding box of a single shape (ignores stroke width). */
export function shapeBounds(shape: Shape): Bounds {
  switch (shape.type) {
    case "rect":
    case "ellipse":
      return normalizeRect(shape.x, shape.y, shape.width, shape.height);
    case "line":
      return normalizeRect(
        shape.x1,
        shape.y1,
        shape.x2 - shape.x1,
        shape.y2 - shape.y1
      );
    case "path":
      return pointsBounds(shape.points);
    case "bezier":
      return pointsBounds(flattenBezier(shape));
  }
}

/** Combined bounding box of several shapes. Returns null when empty. */
export function unionBounds(shapes: Shape[]): Bounds | null {
  if (shapes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const b = shapeBounds(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** World-space center of a shape (rotation pivots around this point). */
export function shapeCenter(shape: Shape): Vec2 {
  const b = shapeBounds(shape);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Axis-aligned bounding box of a shape after its rotation is applied. */
export function worldShapeBounds(shape: Shape): Bounds {
  const b = shapeBounds(shape);
  if (!shape.rotation) return b;
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const cos = Math.cos(shape.rotation);
  const sin = Math.sin(shape.rotation);
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const wx = c.x + dx * cos - dy * sin;
    const wy = c.y + dx * sin + dy * cos;
    minX = Math.min(minX, wx);
    minY = Math.min(minY, wy);
    maxX = Math.max(maxX, wx);
    maxY = Math.max(maxY, wy);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Combined world AABB of several shapes (accounts for rotation). */
export function unionWorldBounds(shapes: Shape[]): Bounds | null {
  if (shapes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const b = worldShapeBounds(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function expandBounds(b: Bounds, by: number): Bounds {
  return {
    x: b.x - by,
    y: b.y - by,
    width: b.width + by * 2,
    height: b.height + by * 2,
  };
}

export function pointInBounds(p: Vec2, b: Bounds): boolean {
  return (
    p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
  );
}
