import { applyMatrix, IDENTITY } from "@/model/geometry/matrix";
import { strokeDetailFields } from "../stroke";
import {
  makeId,
  type Matrix,
  type PathAnchor,
  type PathShape,
  type PathSubpath,
  type Vec2,
} from "../types";

/**
 * Default weld tolerance in the paths' shared (parent) coordinate space. Open
 * endpoints closer than this are connected. Fixed for the first cut; a
 * per-op control is a follow-up.
 */
export const JOIN_TOLERANCE = 6;

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Bake a matrix into an anchor's point and both handles. */
function transformAnchor(m: Matrix, a: PathAnchor): PathAnchor {
  return {
    p: applyMatrix(m, a.p),
    hIn: a.hIn ? applyMatrix(m, a.hIn) : null,
    hOut: a.hOut ? applyMatrix(m, a.hOut) : null,
  };
}

/** Reverse a run of anchors: flip order and swap each anchor's handles. */
function reverseAnchors(anchors: PathAnchor[]): PathAnchor[] {
  return anchors.map((a) => ({ p: a.p, hIn: a.hOut, hOut: a.hIn })).reverse();
}

/** Whether a path shape carries any open subpath that could be joined. */
export function joinableSubpathCount(shape: PathShape): number {
  return shape.subpaths.filter(
    (sp) => !sp.closed && sp.anchors.length >= 2
  ).length;
}

/**
 * Weld the open subpaths of the given path shapes into continuous contours by
 * connecting endpoints that fall within `tolerance` of each other. Every input
 * is baked into the parent coordinate space (its own transform applied), so the
 * result is a single path shape with an identity transform — matching the
 * boolean/outline convention. Closed subpaths pass through untouched. Endpoints
 * further apart than `tolerance` are never connected. Returns null when nothing
 * welds.
 */
export function joinShapes(
  shapes: PathShape[],
  tolerance = JOIN_TOLERANCE
): PathShape | null {
  // Open contours (anchor runs) to weld, plus untouched closed subpaths.
  const open: PathAnchor[][] = [];
  const passthrough: PathSubpath[] = [];
  for (const shape of shapes) {
    const m = shape.transform;
    for (const sp of shape.subpaths) {
      const anchors = sp.anchors.map((a) => transformAnchor(m, a));
      if (sp.closed || anchors.length < 2) {
        passthrough.push({ anchors, closed: sp.closed });
      } else {
        open.push(anchors);
      }
    }
  }

  let welded = false;
  // Weld any two contours whose endpoints meet, orienting each so the junction
  // falls at the tail of the first and the head of the second, then dropping the
  // shared anchor into a single one that keeps the incoming/outgoing handles.
  let progress = true;
  while (progress) {
    progress = false;
    outer: for (let i = 0; i < open.length; i++) {
      for (let j = i + 1; j < open.length; j++) {
        const a = open[i];
        const b = open[j];
        const aHead = a[0].p;
        const aTail = a[a.length - 1].p;
        const bHead = b[0].p;
        const bTail = b[b.length - 1].p;
        // Pick the closest endpoint pairing within tolerance.
        const pairs: [number, PathAnchor[], PathAnchor[]][] = [
          [dist(aTail, bHead), a, b],
          [dist(aTail, bTail), a, reverseAnchors(b)],
          [dist(aHead, bHead), reverseAnchors(a), b],
          [dist(aHead, bTail), reverseAnchors(a), reverseAnchors(b)],
        ];
        pairs.sort((x, y) => x[0] - y[0]);
        const [gap, first, second] = pairs[0];
        if (gap > tolerance) continue;
        const junction: PathAnchor = {
          p: mid(first[first.length - 1].p, second[0].p),
          hIn: first[first.length - 1].hIn,
          hOut: second[0].hOut,
        };
        open[i] = [...first.slice(0, -1), junction, ...second.slice(1)];
        open.splice(j, 1);
        welded = true;
        progress = true;
        break outer;
      }
    }
  }

  const subpaths: PathSubpath[] = open.map((anchors) => {
    // Close a contour whose two ends now coincide, folding the ends together.
    if (
      anchors.length >= 3 &&
      dist(anchors[0].p, anchors[anchors.length - 1].p) <= tolerance
    ) {
      const tail = anchors[anchors.length - 1];
      const head = anchors[0];
      const merged: PathAnchor = {
        p: mid(head.p, tail.p),
        hIn: tail.hIn,
        hOut: head.hOut,
      };
      welded = true;
      return { anchors: [merged, ...anchors.slice(1, -1)], closed: true };
    }
    return { anchors, closed: false };
  });

  if (!welded) return null;

  const base = shapes[0];
  return {
    id: makeId("path"),
    name: "Joined path",
    type: "path",
    subpaths: [...subpaths, ...passthrough],
    fillRule: base.fillRule,
    fill: base.fill,
    stroke: base.stroke,
    strokeWidth: base.strokeWidth,
    ...strokeDetailFields(base),
    opacity: base.opacity,
    blendMode: base.blendMode,
    transform: [...IDENTITY],
    transformOrigin: null,
  };
}
