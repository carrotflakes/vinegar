// ===========================================================================
// Bucket fill — find the enclosed empty region around a point and turn it
// into a fillable polygon (see docs/bucket-fill.md).
//
// Every visible node contributes its painted silhouette ("ink") as Clipper
// polygons. Inflating the ink by half the gap tolerance and unioning it makes
// enclosed empty regions appear as *holes* of the union; the hole containing
// the click point is the region to fill. The hole is then re-expanded so the
// fill tucks slightly under the surrounding ink (no antialiasing seams).
//
// Clicking *on* a fill-painted shape (or image) instead treats that shape as
// a "cover": its area no longer blocks the fill, but its outline becomes the
// region's outer boundary — the raster-bucket behavior of filling up to the
// edges of the color you clicked. Strokes, brushes and text stay hard ink.
// ===========================================================================

import ClipperLib, { type IntPoint, type PolyNode, type PolyTree } from "clipper-lib";
import { flattenSubpath } from "./bezier";
import { cachedBrushEnvelope } from "./brushOutline";
import { shapeBounds } from "./bounds";
import { clippingContentIds, clippingMask } from "./clippingMask";
import { contours, intPath, SCALE, treeToPolys } from "./clipperPaths";
import { applyMatrix, IDENTITY, multiply } from "./matrix";
import { strokeOutline } from "./outlineStroke";
import { roundedRectPolyline } from "./roundedRect";
import { isGroup, isInstance, isShape, scopeRootIds } from "./scene";
import type { Document, Matrix, Shape, Vec2 } from "./types";

export type BucketFillResult =
  /**
   * Polys of the region (PolygonShape layout), in scope-view space. When the
   * click landed on a fill-painted shape, `coverId` is that shape (topmost),
   * so the new fill can be inserted directly above it.
   */
  | { kind: "filled"; polys: Vec2[][][]; coverId: string | null }
  /** The point is not inside any enclosed empty region. */
  | { kind: "open" }
  /** The point sits on painted ink, not in an empty region. */
  | { kind: "inked" };

/**
 * How far the fill tucks under the surrounding ink, in world units. Fills are
 * inserted below the ink, so the overlap hides antialiasing seams along the
 * shared edge without visibly thickening thin strokes.
 */
const BLEED = 0.5;

/** Closed silhouette rings of a shape's geometry, in its local space. */
function fillGeometry(
  shape: Shape
): { rings: Vec2[][]; fillType: number } | null {
  const evenOdd = ClipperLib.PolyFillType.pftEvenOdd;
  switch (shape.type) {
    case "rect":
      return { rings: [roundedRectPolyline(shape)], fillType: evenOdd };
    case "ellipse": {
      const b = shapeBounds(shape);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const pts: Vec2[] = [];
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        pts.push({
          x: cx + (Math.cos(a) * b.width) / 2,
          y: cy + (Math.sin(a) * b.height) / 2,
        });
      }
      return { rings: [pts], fillType: evenOdd };
    }
    case "path":
      // Fill implicitly closes open paths, so they enclose an area here too.
      return shape.points.length >= 3
        ? { rings: [shape.points], fillType: evenOdd }
        : null;
    case "bezier": {
      const rings = shape.subpaths
        .filter((sp) => sp.anchors.length >= 2)
        .map((sp) => flattenSubpath(sp));
      return rings.length
        ? { rings, fillType: ClipperLib.PolyFillType.pftNonZero }
        : null;
    }
    case "polygon":
      return { rings: shape.polys.flat(), fillType: evenOdd };
    case "compoundPath": {
      const rings = shape.components.flatMap((component) => {
        const geom = fillGeometry(component);
        return geom
          ? geom.rings.map((ring) =>
              ring.map((p) => applyMatrix(component.transform, p))
            )
          : [];
      });
      return rings.length ? { rings, fillType: evenOdd } : null;
    }
    case "image":
      return {
        rings: [
          [
            { x: shape.x, y: shape.y },
            { x: shape.x + shape.width, y: shape.y },
            { x: shape.x + shape.width, y: shape.y + shape.height },
            { x: shape.x, y: shape.y + shape.height },
          ],
        ],
        fillType: evenOdd,
      };
    case "text":
      // Coarse: the measured line box stands in for the glyph outlines.
      return {
        rings: [
          [
            { x: shape.x, y: shape.y },
            { x: shape.x + shape.width, y: shape.y },
            { x: shape.x + shape.width, y: shape.y + shape.height },
            { x: shape.x, y: shape.y + shape.height },
          ],
        ],
        fillType: evenOdd,
      };
    case "brush": {
      const ring = cachedBrushEnvelope(shape);
      return ring.length >= 3
        ? { rings: [ring], fillType: ClipperLib.PolyFillType.pftNonZero }
        : null;
    }
    case "line":
      return null;
  }
}

/**
 * Union world-space rings under the given fill rule and append the resulting
 * contours to `out`. Normalizing per source keeps every contour in Clipper's
 * canonical orientation (outers positive, holes negative) regardless of the
 * source's own fill rule, self-intersections, or mirroring transforms, so the
 * combined list accumulates correctly under one nonzero union later.
 */
function pushNormalized(
  out: IntPoint[][],
  rings: Vec2[][],
  fillType: number
): void {
  const paths = rings.map(intPath).filter((ring) => ring.length >= 3);
  if (!paths.length) return;
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(ClipperLib.ClipType.ctUnion, tree, fillType, fillType);
  out.push(...contours(tree));
}

function worldRings(rings: Vec2[][], world: Matrix): Vec2[][] {
  return rings.map((ring) => ring.map((p) => applyMatrix(world, p)));
}

/** Even-odd containment across canonically oriented contours (outer − hole). */
function pointInContours(pt: IntPoint, paths: IntPoint[][]): boolean {
  let count = 0;
  for (const path of paths) {
    if (ClipperLib.Clipper.PointInPolygon(pt, path) !== 0) count++;
  }
  return count % 2 === 1;
}

/** A fill-painted shape whose silhouette contains the click point. */
interface CoverHit {
  id: string;
  contours: IntPoint[][];
}

/** Append one shape's painted silhouette (fill and stroke) to `out`. */
function addShapeObstacles(
  shape: Shape,
  parentWorld: Matrix,
  pt: IntPoint,
  out: IntPoint[][],
  covers: CoverHit[] | null
): void {
  const world = multiply(parentWorld, shape.transform);
  // Area painted by a fill (or image pixels) can act as a cover; brush
  // envelopes and text boxes are stroke-like and always block.
  const coverable =
    shape.type === "image" ||
    (shape.fill !== null &&
      shape.type !== "line" &&
      shape.type !== "brush" &&
      shape.type !== "text");
  const hardPainted =
    (shape.type === "brush" &&
      shape.stroke !== null &&
      shape.strokeWidth > 0) ||
    (shape.type === "text" &&
      (shape.fill !== null || (shape.stroke !== null && shape.strokeWidth > 0)));
  if (coverable || hardPainted) {
    const geom = fillGeometry(shape);
    if (geom) {
      const normalized: IntPoint[][] = [];
      pushNormalized(normalized, worldRings(geom.rings, world), geom.fillType);
      if (covers && coverable && pointInContours(pt, normalized)) {
        covers.push({ id: shape.id, contours: normalized });
      } else {
        out.push(...normalized);
      }
    }
  }
  // Stroke silhouettes come back with the shape transform baked in (parent
  // space). They are hard ink even on a cover shape: a stroked background's
  // outline still bounds the fill.
  const stroke = strokeOutline(shape);
  if (stroke) {
    pushNormalized(
      out,
      worldRings(stroke.flat(), parentWorld),
      ClipperLib.PolyFillType.pftEvenOdd
    );
  }
}

/**
 * Collect the ink contours of the given nodes (and descendants) into `out`.
 * `covers` accumulates fill-painted shapes containing the click point in
 * paint order (last = topmost); it is null inside clip groups and symbol
 * instances, whose composite ink cannot be partially excluded.
 */
function collectObstacles(
  doc: Document,
  ids: string[],
  parentWorld: Matrix,
  pt: IntPoint,
  out: IntPoint[][],
  covers: CoverHit[] | null
): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node || node.hidden) continue;
    const world = multiply(parentWorld, node.transform);
    if (isGroup(node)) {
      const mask = clippingMask(doc, node);
      if (mask) {
        // A clip group's ink is its content restricted to the mask silhouette.
        const content: IntPoint[][] = [];
        collectObstacles(doc, clippingContentIds(doc, node), world, pt, content, null);
        const geom = fillGeometry(mask);
        if (!content.length || !geom) continue;
        const maskWorld = multiply(world, mask.transform);
        const maskPaths = worldRings(geom.rings, maskWorld)
          .map(intPath)
          .filter((ring) => ring.length >= 3);
        const clipper = new ClipperLib.Clipper();
        clipper.AddPaths(content, ClipperLib.PolyType.ptSubject, true);
        clipper.AddPaths(maskPaths, ClipperLib.PolyType.ptClip, true);
        const tree = new ClipperLib.PolyTree();
        clipper.Execute(
          ClipperLib.ClipType.ctIntersection,
          tree,
          ClipperLib.PolyFillType.pftNonZero,
          geom.fillType
        );
        out.push(...contours(tree));
      } else {
        collectObstacles(doc, node.childIds, world, pt, out, covers);
      }
    } else if (isInstance(node)) {
      const def = doc.symbols[node.symbolId];
      const root = def ? doc.nodes[def.rootNodeId] : undefined;
      if (isGroup(root)) {
        collectObstacles(
          doc,
          root.childIds,
          multiply(world, root.transform),
          pt,
          out,
          null
        );
      }
    } else if (isShape(node)) {
      addShapeObstacles(node, parentWorld, pt, out, covers);
    }
  }
}

interface Region {
  outer: IntPoint[];
  holes: IntPoint[][];
}

/**
 * Locate the click point in the inflated-ink poly tree. Islands alternate with
 * holes as the tree descends: a point inside an island but outside all of its
 * holes sits on ink; a point inside a hole but outside the hole's nested
 * islands has found its region (the nested islands' outers become its holes).
 */
function findRegion(
  islands: PolyNode[],
  pt: IntPoint
): Region | "inked" | null {
  for (const island of islands) {
    if (ClipperLib.Clipper.PointInPolygon(pt, island.Contour()) === 0) continue;
    for (const hole of island.Childs()) {
      if (ClipperLib.Clipper.PointInPolygon(pt, hole.Contour()) === 0) continue;
      const nested = findRegion(hole.Childs(), pt);
      if (nested) return nested;
      return {
        outer: hole.Contour(),
        holes: hole.Childs().map((n) => n.Contour()),
      };
    }
    return "inked";
  }
  return null;
}

/**
 * Deepest filled component of a poly tree containing the point, or null when
 * the point only lands on excluded area (holes without a nested component).
 */
function findComponent(outers: PolyNode[], pt: IntPoint): Region | null {
  for (const outer of outers) {
    if (ClipperLib.Clipper.PointInPolygon(pt, outer.Contour()) === 0) continue;
    for (const hole of outer.Childs()) {
      if (ClipperLib.Clipper.PointInPolygon(pt, hole.Contour()) === 0) continue;
      return findComponent(hole.Childs(), pt);
    }
    return {
      outer: outer.Contour(),
      holes: outer.Childs().map((n) => n.Contour()),
    };
  }
  return null;
}

/** Offset a region (outer grows, holes shrink) into a new poly tree. */
function expandRegion(region: Region, delta: number): PolyTree {
  const orient = (path: IntPoint[], positive: boolean): IntPoint[] =>
    ClipperLib.Clipper.Orientation(path) === positive
      ? path
      : [...path].reverse();
  const expand = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  expand.AddPath(
    orient(region.outer, true),
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon
  );
  for (const hole of region.holes) {
    expand.AddPath(
      orient(hole, false),
      ClipperLib.JoinType.jtRound,
      ClipperLib.EndType.etClosedPolygon
    );
  }
  const tree = new ClipperLib.PolyTree();
  expand.Execute(tree, delta * SCALE);
  return tree;
}

/** Inflate ink contours by `delta` and union them into one poly tree. */
function inflateInk(obstacles: IntPoint[][], delta: number): PolyTree {
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  for (const path of obstacles) {
    co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  }
  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, delta * SCALE);
  return tree;
}

/**
 * Compute the fill region around `point` (scope-view space) bounded by the
 * visible ink of the given editing scope. `gapTolerance` (world units) is the
 * widest boundary gap that still counts as closed.
 */
export function computeBucketFill(
  doc: Document,
  scope: string | null,
  point: Vec2,
  gapTolerance: number
): BucketFillResult {
  const pt = {
    X: Math.round(point.x * SCALE),
    Y: Math.round(point.y * SCALE),
  };
  const obstacles: IntPoint[][] = [];
  const covers: CoverHit[] = [];
  collectObstacles(doc, scopeRootIds(doc, scope), IDENTITY, pt, obstacles, covers);

  // Inflate the ink by half the gap tolerance: gaps narrower than the
  // tolerance seal shut, so the region they leak from becomes a closed hole.
  const inflate = Math.max(gapTolerance / 2, 0.05);

  if (covers.length) {
    // The click landed on a fill: the topmost cover's outline is the outer
    // boundary and the remaining (inflated) ink carves the region out of it.
    // Lower covers under the point are invisible there and are ignored.
    const cover = covers[covers.length - 1];
    const ink = obstacles.length ? contours(inflateInk(obstacles, inflate)) : [];
    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(cover.contours, ClipperLib.PolyType.ptSubject, true);
    if (ink.length) clipper.AddPaths(ink, ClipperLib.PolyType.ptClip, true);
    const free = new ClipperLib.PolyTree();
    clipper.Execute(
      ink.length ? ClipperLib.ClipType.ctDifference : ClipperLib.ClipType.ctUnion,
      free,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
    );
    const component = findComponent(free.Childs(), pt);
    if (!component) return { kind: "inked" };
    // Tuck under the strokes like the no-cover path, but never past the
    // cover's own edge — beyond it the fill would show over whatever is
    // underneath, so clip the expansion back to the cover silhouette.
    const expanded = expandRegion(component, inflate + BLEED);
    const clip = new ClipperLib.Clipper();
    clip.AddPaths(contours(expanded), ClipperLib.PolyType.ptSubject, true);
    clip.AddPaths(cover.contours, ClipperLib.PolyType.ptClip, true);
    const final = new ClipperLib.PolyTree();
    clip.Execute(
      ClipperLib.ClipType.ctIntersection,
      final,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
    );
    const polys = treeToPolys(final);
    return polys.length
      ? { kind: "filled", polys, coverId: cover.id }
      : { kind: "inked" };
  }

  if (!obstacles.length) return { kind: "open" };
  const inked = inflateInk(obstacles, inflate);
  const region = findRegion(inked.Childs(), pt);
  if (region === null) return { kind: "open" };
  if (region === "inked") return { kind: "inked" };

  // The hole is the true region eroded by `inflate`; expanding by
  // `inflate + BLEED` restores it and tucks the edge under the ink. This is a
  // morphological opening, so the fill never reaches farther than BLEED past
  // the real empty region (small nub at a bridged gap, underlap elsewhere).
  const polys = treeToPolys(expandRegion(region, inflate + BLEED));
  return polys.length ? { kind: "filled", polys, coverId: null } : { kind: "open" };
}
