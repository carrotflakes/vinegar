import ClipperLib, { type IntPoint, type PolyNode } from "clipper-lib";
import { flattenSubpath } from "./bezier";
import { shapeBounds } from "./bounds";
import { applyMatrix } from "./matrix";
import type { Shape, Vec2 } from "./types";

// Clipper works in integers; scale world units up for sub-pixel precision.
const SCALE = 1000;

interface Polyline {
  points: Vec2[];
  closed: boolean;
}

function withTransform(shape: Shape, points: Vec2[]): Vec2[] {
  return points.map((p) => applyMatrix(shape.transform, p));
}

/** The stroked centerline(s) of a shape, before rotation. */
function centerlines(shape: Shape): Polyline[] {
  switch (shape.type) {
    case "line":
      return [
        {
          points: [
            { x: shape.x1, y: shape.y1 },
            { x: shape.x2, y: shape.y2 },
          ],
          closed: false,
        },
      ];
    case "rect": {
      const b = shapeBounds(shape);
      return [
        {
          points: [
            { x: b.x, y: b.y },
            { x: b.x + b.width, y: b.y },
            { x: b.x + b.width, y: b.y + b.height },
            { x: b.x, y: b.y + b.height },
          ],
          closed: true,
        },
      ];
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rx = b.width / 2;
      const ry = b.height / 2;
      const pts: Vec2[] = [];
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
      return [{ points: pts, closed: true }];
    }
    case "path":
      return [{ points: shape.points, closed: shape.closed }];
    case "bezier":
      return shape.subpaths.map((sp) => ({
        points: flattenSubpath(sp),
        closed: sp.closed,
      }));
    case "polygon":
      return shape.polys.flat().map((ring) => ({ points: ring, closed: true }));
    case "compoundPath":
      return shape.components.flatMap((component) =>
        centerlines(component).map((line) => ({
          ...line,
          points: line.points.map((point) => applyMatrix(component.transform, point)),
        }))
      );
  }
}

function ringFrom(path: IntPoint[]): Vec2[] {
  return path.map((pt) => ({ x: pt.X / SCALE, y: pt.Y / SCALE }));
}

/**
 * Outline a shape's stroke into a filled multi-polygon (world space, rotation
 * baked in), using Clipper's polygon offsetting with round joins/caps to match
 * the renderer. Returns null if the shape has no stroke or produces nothing.
 */
export function strokeOutline(shape: Shape): Vec2[][][] | null {
  if (shape.stroke === null || shape.strokeWidth <= 0) return null;
  const half = shape.strokeWidth / 2;

  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  let added = false;
  for (const pl of centerlines(shape)) {
    const pts = withTransform(shape, pl.points);
    if (pts.length < 2) continue;
    const path: IntPoint[] = pts.map((p) => ({
      X: Math.round(p.x * SCALE),
      Y: Math.round(p.y * SCALE),
    }));
    co.AddPath(
      path,
      ClipperLib.JoinType.jtRound,
      pl.closed
        ? ClipperLib.EndType.etClosedLine
        : ClipperLib.EndType.etOpenRound
    );
    added = true;
  }
  if (!added) return null;

  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, half * SCALE);

  // Walk the PolyTree into [outer, ...holes] polygons.
  const polys: Vec2[][][] = [];
  const walk = (node: PolyNode) => {
    for (const child of node.Childs()) {
      const poly: Vec2[][] = [ringFrom(child.Contour())];
      for (const hole of child.Childs()) poly.push(ringFrom(hole.Contour()));
      polys.push(poly);
      for (const hole of child.Childs()) walk(hole);
    }
  };
  walk(tree);

  return polys.length ? polys : null;
}
