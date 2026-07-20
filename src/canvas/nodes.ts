import { withSubpath } from "../model/path";
import { applyMatrix } from "../model/matrix";
import type { PathShape, BrushShape, Matrix, Vec2 } from "../model/types";
import { worldToScreen, type Viewport } from "../model/viewport";

export type NodePart = "anchor" | "in" | "out";

export interface NodeHit {
  part: NodePart;
  /** Index into `shape.subpaths`. */
  sub: number;
  index: number;
}

/**
 * Shapes whose cubic anchors the node tool can edit. A brush is treated as one
 * open subpath of anchors (its per-anchor width rides along untouched).
 */
export type NodeEditShape = PathShape | BrushShape;

/** Structural read view of a single anchor, shared by bezier and brush. */
interface EditAnchor {
  p: Vec2;
  hIn: Vec2 | null;
  hOut: Vec2 | null;
}

/** Uniform subpath view: bezier's own subpaths, or a brush's single open run. */
export function nodeSubpaths(
  shape: NodeEditShape
): { anchors: readonly EditAnchor[]; closed: boolean }[] {
  return shape.type === "brush"
    ? [{ anchors: shape.anchors, closed: false }]
    : shape.subpaths;
}

function shiftV(v: Vec2 | null, dx: number, dy: number): Vec2 | null {
  return v ? { x: v.x + dx, y: v.y + dy } : null;
}

/** Screen-space sizes (px) for the node-editing chrome. */
export const ANCHOR_SIZE = 9;
export const HANDLE_DOT = 7;

/**
 * Hit-test the anchors and control handles of a Bézier shape against a screen
 * point. Handles take priority over anchors so they remain grabbable.
 */
export function hitNodes(
  shape: NodeEditShape,
  transform: Matrix,
  screen: Vec2,
  viewport: Viewport,
  grabPx = 8,
  preferAnchors = false
): NodeHit | null {
  const subpaths = nodeSubpaths(shape);
  const near = (w: Vec2, tol: number) => {
    const s = worldToScreen(viewport, applyMatrix(transform, w));
    return Math.abs(s.x - screen.x) <= tol && Math.abs(s.y - screen.y) <= tol;
  };
  const hitAnchor = (): NodeHit | null => {
    for (let sub = 0; sub < subpaths.length; sub++) {
      const anchors = subpaths[sub].anchors;
      for (let i = 0; i < anchors.length; i++) {
        if (near(anchors[i].p, grabPx + 1))
          return { part: "anchor", sub, index: i };
      }
    }
    return null;
  };
  const hitHandle = (): NodeHit | null => {
    for (let sub = 0; sub < subpaths.length; sub++) {
      const anchors = subpaths[sub].anchors;
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (a.hOut && near(a.hOut, grabPx))
          return { part: "out", sub, index: i };
        if (a.hIn && near(a.hIn, grabPx))
          return { part: "in", sub, index: i };
      }
    }
    return null;
  };
  return preferAnchors ? hitAnchor() ?? hitHandle() : hitHandle() ?? hitAnchor();
}

/** Move an anchor point to `world`, dragging its handles along with it. The
 * anchor's other fields (e.g. a brush's width) are preserved via spread. */
export function moveAnchor(
  shape: NodeEditShape,
  sub: number,
  index: number,
  world: Vec2
): NodeEditShape {
  if (shape.type === "brush") {
    const a = shape.anchors[index];
    if (!a) return shape;
    const dx = world.x - a.p.x;
    const dy = world.y - a.p.y;
    const anchors = shape.anchors.slice();
    anchors[index] = { ...a, p: world, hIn: shiftV(a.hIn, dx, dy), hOut: shiftV(a.hOut, dx, dy) };
    return { ...shape, anchors };
  }
  const sp = shape.subpaths[sub];
  const a = sp?.anchors[index];
  if (!a) return shape;
  const dx = world.x - a.p.x;
  const dy = world.y - a.p.y;
  const anchors = sp.anchors.slice();
  anchors[index] = { ...a, p: world, hIn: shiftV(a.hIn, dx, dy), hOut: shiftV(a.hOut, dx, dy) };
  return withSubpath(shape, sub, { ...sp, anchors });
}

/**
 * Translate several anchors by one local-space delta. Every target is read from
 * the immutable starting shape so repeated pointer moves never accumulate
 * rounding error. Moving an anchor carries its handles with it.
 */
export function moveAnchors(
  shape: NodeEditShape,
  nodes: readonly { sub: number; index: number }[],
  dx: number,
  dy: number
): NodeEditShape {
  let next = shape;
  const seen = new Set<string>();
  const subpaths = nodeSubpaths(shape);
  for (const node of nodes) {
    const key = `${node.sub}:${node.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const anchor = subpaths[node.sub]?.anchors[node.index];
    if (!anchor) continue;
    next = moveAnchor(next, node.sub, node.index, {
      x: anchor.p.x + dx,
      y: anchor.p.y + dy,
    });
  }
  return next;
}

/**
 * Move one control handle to `world`. When `symmetric` and the opposite handle
 * exists, mirror it across the anchor to keep the node smooth.
 */
export function moveHandle(
  shape: NodeEditShape,
  sub: number,
  index: number,
  part: "in" | "out",
  world: Vec2,
  symmetric: boolean
): NodeEditShape {
  const anchorsOf = shape.type === "brush" ? shape.anchors : shape.subpaths[sub]?.anchors;
  const a = anchorsOf?.[index];
  if (!a || !anchorsOf) return shape;
  const mirror: Vec2 = { x: 2 * a.p.x - world.x, y: 2 * a.p.y - world.y };
  const anchors = anchorsOf.slice();
  if (part === "out") {
    anchors[index] = { ...a, hOut: world, hIn: symmetric && a.hIn ? mirror : a.hIn };
  } else {
    anchors[index] = { ...a, hIn: world, hOut: symmetric && a.hOut ? mirror : a.hOut };
  }
  if (shape.type === "brush") return { ...shape, anchors: anchors as BrushShape["anchors"] };
  return withSubpath(shape, sub, { ...shape.subpaths[sub], anchors: anchors as PathShape["subpaths"][number]["anchors"] });
}
