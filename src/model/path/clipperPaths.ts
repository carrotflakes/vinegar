// Shared conversions between document geometry and Clipper's integer paths,
// used by stroke outlining (outlineStroke.ts) and the bucket fill
// (bucketFill.ts).

import type { IntPoint, PolyNode } from "clipper-lib";
import type { Vec2 } from "../types";

/** Clipper works in integers; scale world units up for sub-pixel precision. */
export const SCALE = 1000;

export function intPath(points: Vec2[]): IntPoint[] {
  return points.map((p) => ({
    X: Math.round(p.x * SCALE),
    Y: Math.round(p.y * SCALE),
  }));
}

export function ringFrom(path: IntPoint[]): Vec2[] {
  return path.map((pt) => ({ x: pt.X / SCALE, y: pt.Y / SCALE }));
}

/** All contours of a poly tree (any depth), keeping their orientation. */
export function contours(node: PolyNode): IntPoint[][] {
  const paths: IntPoint[][] = [];
  const walk = (parent: PolyNode) => {
    for (const child of parent.Childs()) {
      if (child.Contour().length >= 3) paths.push(child.Contour());
      walk(child);
    }
  };
  walk(node);
  return paths;
}

/**
 * Convert a poly tree into grouped rings: an array of polygons,
 * each `[outerRing, ...holeRings]`, recursing into islands inside holes.
 */
export function treeToPolys(tree: PolyNode): Vec2[][][] {
  const polys: Vec2[][][] = [];
  const walk = (node: PolyNode) => {
    for (const child of node.Childs()) {
      const contour = child.Contour();
      if (!contour.length) continue;
      const poly: Vec2[][] = [ringFrom(contour)];
      for (const hole of child.Childs()) {
        if (hole.Contour().length) poly.push(ringFrom(hole.Contour()));
      }
      polys.push(poly);
      for (const hole of child.Childs()) walk(hole);
    }
  };
  walk(tree);
  return polys;
}
