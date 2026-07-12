import { flattenSubpath } from "./bezier";
import { instanceWorldBounds, shapeBounds, worldShapeBounds } from "./bounds";
import { invertMatrix, matrixScale, nodeWorldMatrix, shapeWorldMatrix, transformBounds } from "./matrix";
import { isInstance, isNodeHidden, isShape, scopeLeafIds } from "./scene";
import type { Bounds, Document, Shape, SymbolInstance, Vec2 } from "./types";
import { applyMatrix } from "./matrix";

/** Even-odd point-in-polygon test. */
function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from p to the nearest segment of a polyline (optionally closed). */
function distToPolyline(p: Vec2, pts: Vec2[], closed: boolean): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  }
  if (closed && pts.length > 2) {
    best = Math.min(best, distToSegment(p, pts[pts.length - 1], pts[0]));
  }
  return best;
}

function containsLocal(shape: Shape, p: Vec2): boolean {
  const inverse = invertMatrix(shape.transform);
  if (!inverse) return false;
  p = applyMatrix(inverse, p);
  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      const rx = b.width / 2, ry = b.height / 2;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (p.x - b.x - rx) / rx, ny = (p.y - b.y - ry) / ry;
      return nx * nx + ny * ny <= 1;
    }
    case "path":
      return shape.closed && pointInPolygon(p, shape.points);
    case "bezier":
      return shape.subpaths.reduce(
        (inside, sp) => sp.closed ? inside !== pointInPolygon(p, flattenSubpath(sp)) : inside,
        false
      );
    case "polygon":
      return shape.polys.flat().reduce(
        (inside, ring) => inside !== pointInPolygon(p, ring),
        false
      );
    case "compoundPath":
      return shape.components.reduce(
        (inside, component) => inside !== containsLocal(component, p),
        false
      );
    case "line":
      return false;
  }
}

function strokesLocal(shape: Shape, p: Vec2, tolerance: number): boolean {
  const inverse = invertMatrix(shape.transform);
  if (!inverse) return false;
  p = applyMatrix(inverse, p);
  tolerance /= matrixScale(shape.transform);
  if (shape.type === "compoundPath") {
    return shape.components.some((component) => strokesLocal(component, p, tolerance));
  }
  return localPolylines(shape).some(
    (line) => distToPolyline(p, line.points, line.closed) <= tolerance
  );
}

/** Distance from point p to the segment a-b. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Whether world-point `p` hits the given shape.
 * `tol` is an extra tolerance in world units (scaled for stroke pickability).
 */
export function hitTestShape(doc: Document, shape: Shape, p: Vec2, tol: number): boolean {
  const worldMatrix = shapeWorldMatrix(doc, shape);
  tol /= matrixScale(worldMatrix);
  const hasFill = shape.fill !== null;
  const pickTol = Math.max(tol, shape.stroke ? shape.strokeWidth / 2 + tol : tol);

  const inverse = invertMatrix(worldMatrix);
  if (!inverse) return false;
  p = applyMatrix(inverse, p);

  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      if (hasFill) {
        return (
          p.x >= b.x - tol &&
          p.x <= b.x + b.width + tol &&
          p.y >= b.y - tol &&
          p.y <= b.y + b.height + tol
        );
      }
      // outline only: near any of the four edges
      const corners: Vec2[] = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
        { x: b.x, y: b.y + b.height },
      ];
      for (let i = 0; i < 4; i++) {
        if (distToSegment(p, corners[i], corners[(i + 1) % 4]) <= pickTol)
          return true;
      }
      return false;
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rx = b.width / 2;
      const ry = b.height / 2;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (p.x - cx) / rx;
      const ny = (p.y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (hasFill) {
        return d <= 1 + pickTol / Math.max(rx, ry);
      }
      // ring test: close to the unit circle in normalized space
      const ring = pickTol / Math.min(rx, ry);
      return Math.abs(Math.sqrt(d) - 1) <= ring;
    }
    case "line": {
      return (
        distToSegment(
          p,
          { x: shape.x1, y: shape.y1 },
          { x: shape.x2, y: shape.y2 }
        ) <= pickTol
      );
    }
    case "path": {
      if (hasFill && shape.closed && pointInPolygon(p, shape.points))
        return true;
      return distToPolyline(p, shape.points, shape.closed) <= pickTol;
    }
    case "bezier": {
      if (hasFill) {
        // Even-odd across all closed subpaths, so holes are excluded.
        const inside = shape.subpaths.reduce(
          (acc, sp) =>
            sp.closed
              ? acc !== pointInPolygon(p, flattenSubpath(sp))
              : acc,
          false
        );
        if (inside) return true;
      }
      return shape.subpaths.some(
        (sp) => distToPolyline(p, flattenSubpath(sp), sp.closed) <= pickTol
      );
    }
    case "polygon": {
      const rings = shape.polys.flat();
      if (hasFill) {
        // Even-odd across all rings, so holes are excluded.
        const inside = rings.reduce(
          (acc, ring) => acc !== pointInPolygon(p, ring),
          false
        );
        if (inside) return true;
      }
      for (const ring of rings) {
        if (distToPolyline(p, ring, true) <= pickTol) return true;
      }
      return false;
    }
    case "compoundPath": {
      if (hasFill && shape.components.reduce(
        (inside, component) => inside !== containsLocal(component, p),
        false
      )) return true;
      return shape.stroke !== null && shape.strokeWidth > 0 &&
        shape.components.some((component) =>
          strokesLocal(component, p, shape.strokeWidth / 2 + tol)
        );
    }
  }
}

/**
 * Whether world-point `p` hits a paintable leaf (shape or symbol instance).
 * Instances hit when any leaf of their symbol's content does, tested in
 * symbol-local space.
 */
export function hitTestNode(
  doc: Document,
  node: Shape | SymbolInstance,
  p: Vec2,
  tol: number,
  seen: Set<string> = new Set()
): boolean {
  if (isShape(node)) return hitTestShape(doc, node, p, tol);
  if (seen.has(node.symbolId)) return false;
  const world = nodeWorldMatrix(doc, node.id);
  const inverse = invertMatrix(world);
  if (!inverse) return false;
  const local = applyMatrix(inverse, p);
  const localTol = tol / matrixScale(world);
  seen.add(node.symbolId);
  const leaves = scopeLeafIds(doc, node.symbolId);
  let hit = false;
  for (let i = leaves.length - 1; i >= 0; i--) {
    const leaf = doc.nodes[leaves[i]];
    if (!isShape(leaf) && !isInstance(leaf)) continue;
    if (isNodeHidden(doc, leaf.id)) continue;
    // Leaf world matrices inside a definition are symbol-local, matching
    // the transformed point.
    if (hitTestNode(doc, leaf, local, localTol, seen)) {
      hit = true;
      break;
    }
  }
  seen.delete(node.symbolId);
  return hit;
}

/**
 * Whether a world marquee rectangle intersects a paintable leaf. For
 * instances the region is mapped into symbol space as the AABB of the
 * transformed quad, so rotated instances can over-select slightly.
 */
export function marqueeHitNode(
  doc: Document,
  node: Shape | SymbolInstance,
  region: Bounds,
  seen: Set<string> = new Set()
): boolean {
  if (isShape(node)) return marqueeHitShape(doc, node, region);
  if (seen.has(node.symbolId)) return false;
  const bounds = instanceWorldBounds(doc, node);
  if (!bounds || !rectsIntersect(bounds, region)) return false;
  const world = nodeWorldMatrix(doc, node.id);
  const inverse = invertMatrix(world);
  if (!inverse) return false;
  const localRegion = transformBounds(region, inverse);
  seen.add(node.symbolId);
  const hit = scopeLeafIds(doc, node.symbolId).some((id) => {
    const leaf = doc.nodes[id];
    if (!isShape(leaf) && !isInstance(leaf)) return false;
    if (isNodeHidden(doc, leaf.id)) return false;
    return marqueeHitNode(doc, leaf, localRegion, seen);
  });
  seen.delete(node.symbolId);
  return hit;
}

interface WorldPolyline {
  points: Vec2[];
  closed: boolean;
}

/** Whether a marquee rectangle intersects the shape's rendered geometry. */
export function marqueeHitShape(
  doc: Document,
  shape: Shape,
  region: Bounds
): boolean {
  if (!rectsIntersect(worldShapeBounds(doc, shape), region)) return false;
  const matrix = shapeWorldMatrix(doc, shape);
  const lines = localPolylines(shape).map((line) => ({
    ...line,
    points: line.points.map((point) => applyMatrix(matrix, point)),
  }));
  const stroke = shape.stroke
    ? (shape.strokeWidth / 2) * matrixScale(matrix)
    : 0;
  const edgeRegion = expandBounds(region, stroke);

  for (const line of lines) {
    if (line.points.some((point) => pointInRect(point, edgeRegion))) return true;
    for (let i = 0; i + 1 < line.points.length; i++) {
      if (segmentIntersectsRect(line.points[i], line.points[i + 1], edgeRegion)) {
        return true;
      }
    }
    if (
      line.closed &&
      line.points.length > 2 &&
      segmentIntersectsRect(
        line.points[line.points.length - 1],
        line.points[0],
        edgeRegion
      )
    ) {
      return true;
    }
  }

  const fillable =
    shape.fill !== null &&
    shape.type !== "line" &&
    !(shape.type === "path" && !shape.closed) &&
    !(shape.type === "bezier" && !shape.subpaths.some((sp) => sp.closed));
  if (!fillable) return false;
  const corners = [
    { x: region.x, y: region.y },
    { x: region.x + region.width, y: region.y },
    { x: region.x + region.width, y: region.y + region.height },
    { x: region.x, y: region.y + region.height },
  ];
  return corners.some((corner) => hitTestShape(doc, shape, corner, 0));
}

function rectsIntersect(a: Bounds, b: Bounds): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

function localPolylines(shape: Shape): WorldPolyline[] {
  switch (shape.type) {
    case "rect": {
      const b = shapeBounds(shape);
      return [{
        points: [
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y },
          { x: b.x + b.width, y: b.y + b.height },
          { x: b.x, y: b.y + b.height },
        ],
        closed: true,
      }];
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rx = b.width / 2;
      const ry = b.height / 2;
      return [{
        points: Array.from({ length: 64 }, (_, i) => {
          const angle = (i / 64) * Math.PI * 2;
          return {
            x: cx + Math.cos(angle) * rx,
            y: cy + Math.sin(angle) * ry,
          };
        }),
        closed: true,
      }];
    }
    case "line":
      return [{
        points: [
          { x: shape.x1, y: shape.y1 },
          { x: shape.x2, y: shape.y2 },
        ],
        closed: false,
      }];
    case "path":
      return [{ points: shape.points, closed: shape.closed }];
    case "bezier":
      return shape.subpaths.map((sp) => ({
        points: flattenSubpath(sp),
        closed: sp.closed,
      }));
    case "polygon":
      return shape.polys.flat().map((points) => ({ points, closed: true }));
    case "compoundPath":
      return shape.components.flatMap((component) =>
        localPolylines(component).map((line) => ({
          ...line,
          points: line.points.map((point) => applyMatrix(component.transform, point)),
        }))
      );
  }
}

function expandBounds(bounds: Bounds, amount: number): Bounds {
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  };
}

function pointInRect(point: Vec2, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

/** Liang–Barsky segment/axis-aligned-rectangle intersection. */
function segmentIntersectsRect(a: Vec2, b: Vec2, bounds: Bounds): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [
    a.x - bounds.x,
    bounds.x + bounds.width - a.x,
    a.y - bounds.y,
    bounds.y + bounds.height - a.y,
  ];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
    if (lo > hi) return false;
  }
  return true;
}
