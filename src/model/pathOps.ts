import * as paperNs from "paper";
// paper ships as CJS; depending on the bundler/SSR interop the library lands
// either on the namespace itself or on its `default`.
const paper: typeof paperNs =
  (paperNs as { default?: typeof paperNs }).default ?? paperNs;
import type { PathShape, PathSubpath } from "./types";

/** In-place geometry cleanups that map a path onto a new path of the same shape. */
export type PathOp = "reverse" | "simplify" | "smooth" | "flatten";

export const PATH_OP_LABEL: Record<PathOp, string> = {
  reverse: "Reverse path",
  simplify: "Simplify path",
  smooth: "Smooth path",
  flatten: "Flatten path",
};

// Curve-fit tolerance for simplify and the maximum chord error for flatten, in
// the path's local units. Fixed defaults keep the first cut button-only; a
// per-op tolerance control is a follow-up.
const SIMPLIFY_TOLERANCE = 2.5;
const FLATTEN_TOLERANCE = 0.5;

/** Paper.js needs a project before any path can be built; set one up lazily. */
let paperReady = false;
function ensurePaper(): void {
  if (paperReady) return;
  paper.setup(new paper.Size(1, 1));
  paperReady = true;
}

function subpathToPath(sp: PathSubpath): paper.Path {
  const segments = sp.anchors.map(
    (a) =>
      new paper.Segment(
        new paper.Point(a.p.x, a.p.y),
        a.hIn ? new paper.Point(a.hIn.x - a.p.x, a.hIn.y - a.p.y) : undefined,
        a.hOut ? new paper.Point(a.hOut.x - a.p.x, a.hOut.y - a.p.y) : undefined
      )
  );
  const path = new paper.Path({ segments, insert: false });
  path.closed = sp.closed;
  return path;
}

function pathToSubpath(path: paper.Path, closed: boolean): PathSubpath {
  const anchors = path.segments.map((seg) => {
    const p = { x: seg.point.x, y: seg.point.y };
    return {
      p,
      hIn: seg.handleIn.isZero()
        ? null
        : { x: p.x + seg.handleIn.x, y: p.y + seg.handleIn.y },
      hOut: seg.handleOut.isZero()
        ? null
        : { x: p.x + seg.handleOut.x, y: p.y + seg.handleOut.y },
    };
  });
  return { anchors, closed };
}

/** Flip a subpath's direction: reverse the anchor order and swap each handle. */
function reverseSubpath(sp: PathSubpath): PathSubpath {
  const anchors = sp.anchors
    .map((a) => ({ p: a.p, hIn: a.hOut, hOut: a.hIn }))
    .reverse();
  return { anchors, closed: sp.closed };
}

/**
 * Apply a per-subpath geometry cleanup, preserving each subpath's open/closed
 * state, the shape's transform, style and id. Returns null if nothing changed
 * (e.g. every subpath too short to operate on). Any generator link is dropped
 * because the geometry no longer matches the generator's output.
 */
export function pathOpShape(shape: PathShape, op: PathOp): PathShape | null {
  if (op === "reverse") {
    return {
      ...shape,
      subpaths: shape.subpaths.map(reverseSubpath),
      generator: undefined,
    };
  }
  ensurePaper();
  let changed = false;
  const subpaths = shape.subpaths.map((sp) => {
    if (sp.anchors.length < 2) return sp;
    const path = subpathToPath(sp);
    switch (op) {
      case "simplify":
        path.simplify(SIMPLIFY_TOLERANCE);
        break;
      case "smooth":
        path.smooth();
        break;
      case "flatten":
        path.flatten(FLATTEN_TOLERANCE);
        break;
    }
    if (path.segments.length < 2) return sp;
    changed = true;
    return pathToSubpath(path, sp.closed);
  });
  if (!changed) return null;
  return { ...shape, subpaths, generator: undefined };
}
