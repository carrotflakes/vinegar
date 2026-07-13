import { flattenSubpath } from "./bezier";
import {
  expandBounds,
  instanceWorldBounds,
  intersectBounds,
  pointInBounds,
  shapeBounds,
  worldShapeBounds,
} from "./bounds";
import {
  clippingMaskAncestors,
  isClippingMaskNode,
  isNodeVisibleForHitTesting,
  shapeFillRule,
  type ClippingMaskShape,
} from "./clippingMask";
import { invertMatrix, matrixScale, nodeWorldMatrix, shapeWorldMatrix, transformBounds } from "./matrix";
import { isInstance, isShape, scopeLeafIds } from "./scene";
import { effectiveStrokeAlignment, strokeOutset } from "./stroke";
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

function pointOnPolygonBoundary(p: Vec2, poly: Vec2[]): boolean {
  if (poly.length < 2) return false;
  for (let i = 0; i < poly.length; i++) {
    if (distToSegment(p, poly[i], poly[(i + 1) % poly.length]) <= 1e-9) {
      return true;
    }
  }
  return false;
}

/** Signed winding count used by Canvas/SVG's non-zero fill rule. */
function polygonWinding(p: Vec2, poly: Vec2[]): number {
  let winding = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y) {
      if (b.y > p.y && cross > 0) winding += 1;
    } else if (b.y <= p.y && cross < 0) {
      winding -= 1;
    }
  }
  return winding;
}

function containsRings(
  rings: Vec2[][],
  p: Vec2,
  rule: "nonzero" | "evenodd"
): boolean {
  if (rings.some((ring) => pointOnPolygonBoundary(p, ring))) return true;
  if (rule === "evenodd") {
    return rings.reduce(
      (inside, ring) => inside !== pointInPolygon(p, ring),
      false
    );
  }
  return rings.reduce((winding, ring) => winding + polygonWinding(p, ring), 0) !== 0;
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

function containsTransformedGeometry(
  shape: Shape,
  p: Vec2,
  rule: "nonzero" | "evenodd"
): boolean {
  const inverse = invertMatrix(shape.transform);
  if (!inverse) return false;
  return containsGeometry(shape, applyMatrix(inverse, p), rule);
}

/** Fill containment using geometry only: paint and visibility are ignored. */
function containsGeometry(
  shape: Shape,
  p: Vec2,
  rule: "nonzero" | "evenodd"
): boolean {
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
      return shape.closed && containsRings([shape.points], p, rule);
    case "bezier":
      return containsRings(
        shape.subpaths.filter((subpath) => subpath.closed).map(flattenSubpath),
        p,
        rule
      );
    case "polygon":
      return containsRings(shape.polys.flat(), p, rule);
    case "compoundPath":
      return shape.components.reduce(
        (inside, component) =>
          inside !== containsTransformedGeometry(component, p, "evenodd"),
        false
      );
    case "line":
    case "image":
    case "text":
      return false;
  }
}

function containsLocal(shape: Shape, p: Vec2): boolean {
  return containsTransformedGeometry(shape, p, shapeFillRule(shape));
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

/** Whether a world point lies in a clipping shape's paint-independent fill. */
export function hitTestClippingMask(
  doc: Document,
  shape: ClippingMaskShape,
  p: Vec2
): boolean {
  const inverse = invertMatrix(shapeWorldMatrix(doc, shape));
  if (!inverse) return false;
  return containsGeometry(
    shape,
    applyMatrix(inverse, p),
    shapeFillRule(shape)
  );
}

function pointPassesAncestorMasks(
  doc: Document,
  nodeId: string,
  p: Vec2
): boolean {
  return clippingMaskAncestors(doc, nodeId).every((mask) =>
    hitTestClippingMask(doc, mask, p)
  );
}

/**
 * Whether world-point `p` hits the given shape.
 * `tol` is an extra tolerance in world units (scaled for stroke pickability).
 */
export function hitTestShape(doc: Document, shape: Shape, p: Vec2, tol: number): boolean {
  if (!pointPassesAncestorMasks(doc, shape.id, p)) return false;
  if (isClippingMaskNode(doc, shape.id)) {
    return hitTestClippingMask(doc, shape as ClippingMaskShape, p);
  }
  const worldMatrix = shapeWorldMatrix(doc, shape);
  tol /= matrixScale(worldMatrix);
  const hasFill = shape.fill !== null;
  const alignment = effectiveStrokeAlignment(shape);
  const strokeReach = shape.stroke
    ? (alignment === "center" ? shape.strokeWidth / 2 : shape.strokeWidth)
    : 0;
  const pickTol = Math.max(tol, strokeReach + tol);

  const inverse = invertMatrix(worldMatrix);
  if (!inverse) return false;
  p = applyMatrix(inverse, p);

  const hitsStroke = (distance: number, inside: boolean) => {
    if (!shape.stroke || shape.strokeWidth <= 0 || distance > pickTol) return false;
    // Keep the centerline easy to acquire, then enforce the visible side.
    if (distance <= tol || alignment === "center") return true;
    return alignment === "inside" ? inside : !inside;
  };

  switch (shape.type) {
    case "text": {
      const b = shapeBounds(shape);
      return (
        p.x >= b.x - tol &&
        p.x <= b.x + b.width + tol &&
        p.y >= b.y - tol &&
        p.y <= b.y + b.height + tol
      );
    }
    case "image": {
      // Images are opaque content: anywhere inside the rect hits.
      const b = shapeBounds(shape);
      return (
        p.x >= b.x - tol &&
        p.x <= b.x + b.width + tol &&
        p.y >= b.y - tol &&
        p.y <= b.y + b.height + tol
      );
    }
    case "rect": {
      const b = shapeBounds(shape);
      const inside =
        p.x >= b.x && p.x <= b.x + b.width &&
        p.y >= b.y && p.y <= b.y + b.height;
      if (
        hasFill &&
        p.x >= b.x - tol && p.x <= b.x + b.width + tol &&
        p.y >= b.y - tol && p.y <= b.y + b.height + tol
      ) return true;
      const corners: Vec2[] = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
        { x: b.x, y: b.y + b.height },
      ];
      for (let i = 0; i < 4; i++) {
        if (hitsStroke(distToSegment(p, corners[i], corners[(i + 1) % 4]), inside)) return true;
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
      const inside = d <= 1;
      if (hasFill && d <= 1 + tol / Math.max(rx, ry)) return true;
      const distance = Math.abs(Math.sqrt(d) - 1) * Math.min(rx, ry);
      return hitsStroke(distance, inside);
    }
    case "line": {
      return hitsStroke(
        distToSegment(
          p,
          { x: shape.x1, y: shape.y1 },
          { x: shape.x2, y: shape.y2 }
        ),
        false
      );
    }
    case "path": {
      const inside = shape.closed && pointInPolygon(p, shape.points);
      if (hasFill && inside) return true;
      return hitsStroke(distToPolyline(p, shape.points, shape.closed), inside);
    }
    case "bezier": {
      const inside = shape.subpaths.reduce(
        (acc, sp) => sp.closed ? acc !== pointInPolygon(p, flattenSubpath(sp)) : acc,
        false
      );
      if (hasFill && inside) return true;
      return shape.subpaths.some((sp) =>
        hitsStroke(distToPolyline(p, flattenSubpath(sp), sp.closed), inside)
      );
    }
    case "polygon": {
      const rings = shape.polys.flat();
      const inside = rings.reduce((acc, ring) => acc !== pointInPolygon(p, ring), false);
      if (hasFill && inside) return true;
      for (const ring of rings) {
        if (hitsStroke(distToPolyline(p, ring, true), inside)) return true;
      }
      return false;
    }
    case "compoundPath": {
      const inside = shape.components.reduce(
        (inside, component) => inside !== containsLocal(component, p),
        false
      );
      if (hasFill && inside) return true;
      const sideMatches = alignment === "center" ||
        (alignment === "inside" ? inside : !inside);
      return shape.stroke !== null && shape.strokeWidth > 0 &&
        sideMatches &&
        shape.components.some((component) =>
          strokesLocal(component, p, pickTol)
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
  if (!pointPassesAncestorMasks(doc, node.id, p)) return false;
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
    if (!isNodeVisibleForHitTesting(doc, leaf.id)) continue;
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
  const clippedRegion = marqueeRegionInsideAncestorMasks(doc, node.id, region);
  if (!clippedRegion) return false;
  if (seen.has(node.symbolId)) return false;
  const bounds = instanceWorldBounds(doc, node);
  if (!bounds || !rectsIntersect(bounds, clippedRegion)) return false;
  const world = nodeWorldMatrix(doc, node.id);
  const inverse = invertMatrix(world);
  if (!inverse) return false;
  const localRegion = transformBounds(clippedRegion, inverse);
  seen.add(node.symbolId);
  const hit = scopeLeafIds(doc, node.symbolId).some((id) => {
    const leaf = doc.nodes[id];
    if (!isShape(leaf) && !isInstance(leaf)) return false;
    if (!isNodeVisibleForHitTesting(doc, leaf.id)) return false;
    return marqueeHitNode(doc, leaf, localRegion, seen);
  });
  seen.delete(node.symbolId);
  return hit;
}

interface WorldPolyline {
  points: Vec2[];
  closed: boolean;
}

/** Whether a marquee intersects a mask's paint-independent filled silhouette. */
export function marqueeHitClippingMask(
  doc: Document,
  shape: ClippingMaskShape,
  region: Bounds
): boolean {
  if (!rectsIntersect(worldShapeBounds(doc, shape), region)) return false;
  const matrix = shapeWorldMatrix(doc, shape);
  const lines = localPolylines(shape).map((line) => ({
    ...line,
    points: line.points.map((point) => applyMatrix(matrix, point)),
  }));

  for (const line of lines) {
    if (line.points.some((point) => pointInBounds(point, region))) return true;
    for (let i = 0; i + 1 < line.points.length; i++) {
      if (segmentIntersectsRect(line.points[i], line.points[i + 1], region)) {
        return true;
      }
    }
    if (
      line.closed &&
      line.points.length > 2 &&
      segmentIntersectsRect(
        line.points[line.points.length - 1],
        line.points[0],
        region
      )
    ) {
      return true;
    }
  }

  const corners = [
    { x: region.x, y: region.y },
    { x: region.x + region.width, y: region.y },
    { x: region.x + region.width, y: region.y + region.height },
    { x: region.x, y: region.y + region.height },
  ];
  return corners.some((corner) => hitTestClippingMask(doc, shape, corner));
}

function marqueeRegionInsideAncestorMasks(
  doc: Document,
  nodeId: string,
  region: Bounds
): Bounds | null {
  let clipped = region;
  for (const mask of clippingMaskAncestors(doc, nodeId)) {
    const next = intersectBounds(clipped, worldShapeBounds(doc, mask));
    if (!next || !marqueeHitClippingMask(doc, mask, next)) return null;
    clipped = next;
  }
  return clipped;
}

/** Whether a marquee rectangle intersects the shape's rendered geometry. */
export function marqueeHitShape(
  doc: Document,
  shape: Shape,
  region: Bounds
): boolean {
  const clippedRegion = marqueeRegionInsideAncestorMasks(doc, shape.id, region);
  if (!clippedRegion) return false;
  region = clippedRegion;
  if (isClippingMaskNode(doc, shape.id)) {
    return marqueeHitClippingMask(doc, shape as ClippingMaskShape, region);
  }
  const matrix = shapeWorldMatrix(doc, shape);
  const visualBounds = expandBounds(
    worldShapeBounds(doc, shape),
    strokeOutset(shape) * matrixScale(matrix)
  );
  if (!rectsIntersect(visualBounds, region)) return false;
  const lines = localPolylines(shape).map((line) => ({
    ...line,
    points: line.points.map((point) => applyMatrix(matrix, point)),
  }));
  const alignment = effectiveStrokeAlignment(shape);
  const stroke = shape.stroke
    ? (alignment === "center" ? shape.strokeWidth / 2 : shape.strokeWidth) * matrixScale(matrix)
    : 0;
  // This is intentionally conservative: expanding the marquee catches the
  // visible stroke extent, but does not polygon-clip the candidate region to
  // the inside/outside half. Exact side-aware marquee selection would require
  // intersecting the aligned stroke outline with the marquee.
  const edgeRegion = expandBounds(region, stroke);

  for (const line of lines) {
    if (line.points.some((point) => pointInBounds(point, edgeRegion))) return true;
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
    (shape.fill !== null || shape.type === "image" || shape.type === "text") &&
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
    case "rect":
    case "image":
    case "text": {
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
