// ===========================================================================
// Bucket fill — find the enclosed empty region around a point and turn it
// into a fillable polygon (see docs/design/bucket-fill.md).
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
import { brushCenterlineSamples } from "@/model/brush/brushOutline";
import { shapeBounds } from "@/model/geometry/bounds";
import { shapeFillRule, shapeRings } from "@/model/path/shapeGeometry";
import { contours, intPath, SCALE, treeToPolys } from "@/model/path/clipperPaths";
import { applyMatrix, IDENTITY, multiply } from "@/model/geometry/matrix";
import { strokeOutline } from "@/model/path/outlineStroke";
import { isShape, scopeRootIds } from "./scene";
import { containerContents } from "./sceneWalk";
import type { Document, FrameNode, Matrix, Shape, Vec2 } from "./types";

export type BucketFillResult =
  /**
   * Grouped rings of the region, in scope-view space. When the
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

/**
 * Half-width of the hairline band standing in for a stroke in centerline
 * mode. It only has to give Clipper an area to inflate; the fill's final edge
 * lands `BLEED` past the centerline regardless (hidden under the stroke).
 */
const CENTERLINE_HALF = 0.05;

/** Closed silhouette rings of a shape's geometry, in its local space. */
function fillGeometry(
  shape: Shape,
  doc?: Document
): { rings: Vec2[][]; fillType: number } | null {
  // Images and text have no outline of their own; their box stands in for the
  // silhouette (for text that is deliberately coarse — the measured line box
  // rather than the glyph outlines).
  if (shape.type === "image" || shape.type === "text") {
    const b = shapeBounds(shape);
    return {
      rings: [
        [
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y },
          { x: b.x + b.width, y: b.y + b.height },
          { x: b.x, y: b.y + b.height },
        ],
      ],
      fillType: ClipperLib.PolyFillType.pftEvenOdd,
    };
  }
  const rings = shapeRings(shape, doc);
  if (!rings.length) return null;
  return {
    rings,
    fillType: shapeFillRule(shape) === "evenodd"
      ? ClipperLib.PolyFillType.pftEvenOdd
      : ClipperLib.PolyFillType.pftNonZero,
  };
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

/**
 * One ink contribution in paint order. `coverId` marks a fill silhouette that
 * contains the click point — a cover candidate rather than an obstacle.
 */
interface InkEntry {
  contours: IntPoint[][];
  coverId?: string;
}

/** Canonically oriented contours of `subject` restricted to `clip`. */
function intersectContours(
  subject: IntPoint[][],
  clip: IntPoint[][],
  clipFillType: number
): IntPoint[][] {
  if (!subject.length || !clip.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(
    ClipperLib.ClipType.ctIntersection,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    clipFillType
  );
  return contours(tree);
}

/**
 * A frame's edge as ink: a hairline band along its content box.
 *
 * The frame's *area* is not ink — that would make its interior unfillable. Only
 * the border is, so an artboard closes regions against the rectangle the user
 * can see, exactly as a stroked rect drawn in its place would. Like the
 * centerline band this is a fixed world-space hairline; the fill's own bleed
 * puts its edge `BLEED` past the border either way.
 */
function frameEdgeInk(boxPaths: IntPoint[][]): IntPoint[][] {
  if (!boxPaths.length) return [];
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  for (const path of boxPaths) {
    co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedLine);
  }
  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, CENTERLINE_HALF * SCALE);
  return contours(tree);
}

/** A frame's content box as one world-space ring. */
function frameBoxPaths(frame: FrameNode, world: Matrix): IntPoint[][] {
  const ring = [
    { x: 0, y: 0 },
    { x: frame.width, y: 0 },
    { x: frame.width, y: frame.height },
    { x: 0, y: frame.height },
  ];
  return worldRings([ring], world)
    .map(intPath)
    .filter((path) => path.length >= 3);
}

/** Append one shape's painted silhouette (fill and stroke) to `entries`. */
function addShapeObstacles(
  doc: Document,
  shape: Shape,
  parentWorld: Matrix,
  pt: IntPoint,
  entries: InkEntry[],
  allowCovers: boolean,
  strokeCenterline: boolean
): void {
  const world = multiply(parentWorld, shape.transform);
  // Centerline mode: a brush blocks along its centerline, not its envelope.
  // Lone dots (fewer than 2 samples) keep their envelope below.
  if (
    strokeCenterline &&
    shape.type === "brush" &&
    shape.stroke !== null &&
    shape.strokeWidth > 0
  ) {
    const samples = brushCenterlineSamples(shape);
    if (samples.length >= 2) {
      const pts = samples.map((s) => applyMatrix(world, s.p));
      const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
      co.AddPath(
        intPath(pts),
        ClipperLib.JoinType.jtRound,
        ClipperLib.EndType.etOpenRound
      );
      const tree = new ClipperLib.PolyTree();
      co.Execute(tree, CENTERLINE_HALF * SCALE);
      const band = contours(tree);
      if (band.length) entries.push({ contours: band });
      return;
    }
  }
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
    const geom = fillGeometry(shape, doc);
    if (geom) {
      const normalized: IntPoint[][] = [];
      pushNormalized(normalized, worldRings(geom.rings, world), geom.fillType);
      if (normalized.length) {
        const isCover =
          allowCovers && coverable && pointInContours(pt, normalized);
        entries.push(
          isCover ? { contours: normalized, coverId: shape.id } : { contours: normalized }
        );
      }
    }
  }
  // Stroke silhouettes come back with the shape transform baked in (parent
  // space). They are hard ink even on a cover shape: a stroked background's
  // outline still bounds the fill (the stroke paints above its own fill, so
  // its entry follows the cover entry in paint order). Centerline mode swaps
  // the painted band for a hairline along the geometric centerline.
  const stroke = strokeOutline(
    shape,
    strokeCenterline ? CENTERLINE_HALF : undefined,
    doc
  );
  if (stroke) {
    const normalized: IntPoint[][] = [];
    pushNormalized(
      normalized,
      worldRings(stroke.flat(), parentWorld),
      ClipperLib.PolyFillType.pftEvenOdd
    );
    if (normalized.length) entries.push({ contours: normalized });
  }
}

/**
 * Collect the ink of the given nodes (and descendants) into `entries`, in
 * paint order (back-to-front, matching the renderer's traversal). Cover
 * detection is disabled inside clip groups and symbol instances, whose
 * composite ink cannot be partially excluded.
 */
function collectObstacles(
  doc: Document,
  ids: string[],
  parentWorld: Matrix,
  pt: IntPoint,
  entries: InkEntry[],
  allowCovers: boolean,
  strokeCenterline: boolean,
  activeSymbols: Set<string> = new Set()
): void {
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node || node.hidden) continue;
    const world = multiply(parentWorld, node.transform);
    if (isShape(node)) {
      addShapeObstacles(doc, node, parentWorld, pt, entries, allowCovers, strokeCenterline);
      continue;
    }
    const contents = containerContents(doc, node, activeSymbols);
    if (!contents) continue;
    if (contents.kind === "group" && contents.mask) {
      const { mask } = contents;
      // A clip group's ink is its content restricted to the mask silhouette.
      const inner: InkEntry[] = [];
      collectObstacles(
        doc,
        contents.childIds,
        world,
        pt,
        inner,
        false,
        strokeCenterline,
        activeSymbols
      );
      const content = inner.flatMap((e) => e.contours);
      const geom = fillGeometry(mask, doc);
      if (!content.length || !geom) continue;
      const maskWorld = multiply(world, mask.transform);
      const maskPaths = worldRings(geom.rings, maskWorld)
        .map(intPath)
        .filter((ring) => ring.length >= 3);
      const clipped = intersectContours(content, maskPaths, geom.fillType);
      if (clipped.length) entries.push({ contours: clipped });
      continue;
    }
    if (contents.kind === "frame") {
      const boxPaths = frameBoxPaths(contents.frame, world);
      // The frame's border is ink, at the frame's own place in paint order
      // (before its children, like the background box it paints). An artboard
      // bounds what is drawn in it, so an empty frame can be filled and a line
      // crossing one closes against the edge the user sees.
      const edge = frameEdgeInk(boxPaths);
      if (edge.length) entries.push({ contours: edge });
      if (!contents.frame.clipsContent) {
        collectObstacles(
          doc,
          contents.childIds,
          world,
          pt,
          entries,
          allowCovers,
          strokeCenterline,
          activeSymbols
        );
        continue;
      }
      // The frame crops what it paints, so ink outside its box must not block a
      // fill inside it. Unlike a clip group, each entry is cropped on its own
      // rather than merged into one silhouette: a frame is an ordinary
      // container, and flattening it would stop a shape inside an artboard from
      // acting as a cover.
      const inner: InkEntry[] = [];
      collectObstacles(
        doc,
        contents.childIds,
        world,
        pt,
        inner,
        allowCovers,
        strokeCenterline,
        activeSymbols
      );
      if (!boxPaths.length) continue;
      for (const entry of inner) {
        const clipped = intersectContours(
          entry.contours,
          boxPaths,
          ClipperLib.PolyFillType.pftNonZero
        );
        if (!clipped.length) continue;
        // Cropping can move the cover's area off the click point (a cover that
        // only reached it from outside the frame), so re-check rather than
        // carrying the flag across.
        entries.push(
          entry.coverId && pointInContours(pt, clipped)
            ? { contours: clipped, coverId: entry.coverId }
            : { contours: clipped }
        );
      }
      continue;
    }
    // A plain group, a frame or an instance: its children are obstacles in the
    // container's own space. An instance stops covers from escaping the symbol,
    // and pushes its id so a cyclic reference cannot recurse forever.
    const instanceOf = contents.kind === "instance" ? contents.symbolId : null;
    if (instanceOf) activeSymbols.add(instanceOf);
    collectObstacles(
      doc,
      contents.childIds,
      world,
      pt,
      entries,
      instanceOf ? false : allowCovers,
      strokeCenterline,
      activeSymbols
    );
    if (instanceOf) activeSymbols.delete(instanceOf);
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
 * widest boundary gap that still counts as closed. With `strokeCenterline`,
 * strokes and brushes bound the fill at their centerline instead of their
 * painted edge, so adjacent fills meet under the line with no gap when the
 * line is later thinned, recolored, or removed.
 */
export function computeBucketFill(
  doc: Document,
  scope: string | null,
  point: Vec2,
  gapTolerance: number,
  strokeCenterline = false
): BucketFillResult {
  const pt = {
    X: Math.round(point.x * SCALE),
    Y: Math.round(point.y * SCALE),
  };
  const entries: InkEntry[] = [];
  collectObstacles(
    doc,
    scopeRootIds(doc, scope),
    IDENTITY,
    pt,
    entries,
    true,
    strokeCenterline
  );
  let coverIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].coverId) coverIdx = i;
  }

  // Inflate the ink by half the gap tolerance: gaps narrower than the
  // tolerance seal shut, so the region they leak from becomes a closed hole.
  const inflate = Math.max(gapTolerance / 2, 0.05);

  if (coverIdx >= 0) {
    // The click landed on a fill: the topmost cover's outline is the outer
    // boundary and the (inflated) ink carves the region out of it. The region
    // never leaves the cover, and the cover hides everything painted before
    // it, so only ink *above* the cover in paint order can visibly bound the
    // fill — earlier entries (lower covers included) are ignored.
    const cover = entries[coverIdx];
    const obstacles = entries.slice(coverIdx + 1).flatMap((e) => e.contours);
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
      ? { kind: "filled", polys, coverId: cover.coverId! }
      : { kind: "inked" };
  }

  const obstacles = entries.flatMap((e) => e.contours);
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
