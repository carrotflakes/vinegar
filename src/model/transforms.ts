import { normalizeRect } from "./bounds";
import type { Bounds, Shape, Vec2 } from "./types";

/**
 * Apply a point-mapping function to every defining point of a shape and
 * return a new shape. Works for translation and axis-aligned scaling.
 */
export function transformShape(shape: Shape, fn: (p: Vec2) => Vec2): Shape {
  const transformOrigin = shape.transformOrigin
    ? fn(shape.transformOrigin)
    : null;
  switch (shape.type) {
    case "rect":
    case "ellipse": {
      const a = fn({ x: shape.x, y: shape.y });
      const b = fn({ x: shape.x + shape.width, y: shape.y + shape.height });
      const r = normalizeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      return {
        ...shape,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        transformOrigin,
      };
    }
    case "line": {
      const a = fn({ x: shape.x1, y: shape.y1 });
      const b = fn({ x: shape.x2, y: shape.y2 });
      return { ...shape, x1: a.x, y1: a.y, x2: b.x, y2: b.y, transformOrigin };
    }
    case "path": {
      return { ...shape, points: shape.points.map(fn), transformOrigin };
    }
    case "bezier": {
      return {
        ...shape,
        anchors: shape.anchors.map((an) => ({
          p: fn(an.p),
          hIn: an.hIn ? fn(an.hIn) : null,
          hOut: an.hOut ? fn(an.hOut) : null,
        })),
        transformOrigin,
      };
    }
    case "polygon": {
      return {
        ...shape,
        polys: shape.polys.map((poly) => poly.map((ring) => ring.map(fn))),
        transformOrigin,
      };
    }
  }
}

export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  return transformShape(shape, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Scale a shape so that its position relative to `from` bounds maps into
 * `to` bounds. Used by the resize handles.
 */
export function resizeShapeToBounds(
  shape: Shape,
  from: Bounds,
  to: Bounds
): Shape {
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  return transformShape(shape, (p) => ({
    x: to.x + (p.x - from.x) * sx,
    y: to.y + (p.y - from.y) * sy,
  }));
}
