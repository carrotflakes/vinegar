import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Ring } from "polygon-clipping";
import { flattenBezier } from "./bezier";
import { shapeBounds } from "./bounds";
import { applyMatrix, IDENTITY } from "./matrix";
import { makeId, type PolygonShape, type Shape, type Vec2 } from "./types";

export type BoolOp = "union" | "subtract" | "intersect" | "xor";

const ELLIPSE_SEGMENTS = 64;

function ringFrom(points: Vec2[]): Ring {
  const ring: Ring = points.map((p) => [p.x, p.y]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function withTransform(shape: Shape, points: Vec2[]): Vec2[] {
  return points.map((p) => applyMatrix(shape.transform, p));
}

/** Convert a shape to a MultiPolygon in world space, or null if it has no area. */
function shapeToGeom(shape: Shape): MultiPolygon | null {
  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      const pts = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
        { x: b.x, y: b.y + b.height },
      ];
      return [[ringFrom(withTransform(shape, pts))]];
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rx = b.width / 2;
      const ry = b.height / 2;
      const pts: Vec2[] = [];
      for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
        const a = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
        pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
      return [[ringFrom(withTransform(shape, pts))]];
    }
    case "path":
      if (!shape.closed || shape.points.length < 3) return null;
      return [[ringFrom(withTransform(shape, shape.points))]];
    case "bezier": {
      if (!shape.closed) return null;
      const pts = flattenBezier(shape);
      if (pts.length < 3) return null;
      return [[ringFrom(withTransform(shape, pts))]];
    }
    case "polygon":
      return shape.polys.map((poly) =>
        poly.map((ring) => ringFrom(withTransform(shape, ring)))
      );
    case "line":
      return null;
  }
}

/** Whether a shape encloses an area and can take part in boolean operations. */
export function isAreal(shape: Shape): boolean {
  switch (shape.type) {
    case "rect":
    case "ellipse":
    case "polygon":
      return true;
    case "path":
    case "bezier":
      return shape.closed;
    case "line":
      return false;
  }
}

const OP_NAME: Record<BoolOp, string> = {
  union: "Union",
  subtract: "Subtract",
  intersect: "Intersect",
  xor: "Exclude",
};

/**
 * Combine areal shapes with a boolean operation, in document order. `subtract`
 * removes every later shape from the first (bottom-most). Returns a single
 * polygon shape, or null if there are <2 areal inputs or the result is empty.
 */
export function booleanShapes(shapes: Shape[], op: BoolOp): PolygonShape | null {
  const geoms = shapes
    .map(shapeToGeom)
    .filter((g): g is MultiPolygon => g !== null);
  if (geoms.length < 2) return null;

  const [first, ...rest] = geoms;
  let result: MultiPolygon;
  switch (op) {
    case "union":
      result = polygonClipping.union(first, ...rest);
      break;
    case "intersect":
      result = polygonClipping.intersection(first, ...rest);
      break;
    case "xor":
      result = polygonClipping.xor(first, ...rest);
      break;
    case "subtract":
      result = polygonClipping.difference(first, ...rest);
      break;
  }
  if (!result || result.length === 0) return null;

  const polys: Vec2[][][] = result.map((poly) =>
    poly.map((ring) => {
      const pts = ring.map(([x, y]) => ({ x, y }));
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (pts.length > 1 && a.x === b.x && a.y === b.y) pts.pop();
      return pts;
    })
  );

  const base = shapes[0];
  return {
    id: makeId("polygon"),
    name: OP_NAME[op],
    type: "polygon",
    polys,
    fill: base.fill,
    stroke: base.stroke,
    strokeWidth: base.strokeWidth,
    opacity: base.opacity,
    blendMode: base.blendMode,
    transform: [...IDENTITY],
    transformOrigin: null,
  };
}
