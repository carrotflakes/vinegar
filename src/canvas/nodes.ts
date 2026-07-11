import { withSubpath } from "../model/bezier";
import { applyMatrix } from "../model/matrix";
import type { BezierShape, Matrix, Vec2 } from "../model/types";
import { worldToScreen, type Viewport } from "../model/viewport";

export type NodePart = "anchor" | "in" | "out";

export interface NodeHit {
  part: NodePart;
  /** Index into `shape.subpaths`. */
  sub: number;
  index: number;
}

/** Screen-space sizes (px) for the node-editing chrome. */
export const ANCHOR_SIZE = 9;
export const HANDLE_DOT = 7;

/**
 * Hit-test the anchors and control handles of a Bézier shape against a screen
 * point. Handles take priority over anchors so they remain grabbable.
 */
export function hitBezierNodes(
  shape: BezierShape,
  transform: Matrix,
  screen: Vec2,
  viewport: Viewport,
  grabPx = 8
): NodeHit | null {
  const near = (w: Vec2, tol: number) => {
    const s = worldToScreen(viewport, applyMatrix(transform, w));
    return Math.abs(s.x - screen.x) <= tol && Math.abs(s.y - screen.y) <= tol;
  };
  // Handles first.
  for (let sub = 0; sub < shape.subpaths.length; sub++) {
    const anchors = shape.subpaths[sub].anchors;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (a.hOut && near(a.hOut, grabPx)) return { part: "out", sub, index: i };
      if (a.hIn && near(a.hIn, grabPx)) return { part: "in", sub, index: i };
    }
  }
  for (let sub = 0; sub < shape.subpaths.length; sub++) {
    const anchors = shape.subpaths[sub].anchors;
    for (let i = 0; i < anchors.length; i++) {
      if (near(anchors[i].p, grabPx + 1)) return { part: "anchor", sub, index: i };
    }
  }
  return null;
}

/** Move an anchor point to `world`, dragging its handles along with it. */
export function moveAnchor(
  shape: BezierShape,
  sub: number,
  index: number,
  world: Vec2
): BezierShape {
  const sp = shape.subpaths[sub];
  const a = sp?.anchors[index];
  if (!a) return shape;
  const dx = world.x - a.p.x;
  const dy = world.y - a.p.y;
  const shift = (v: Vec2 | null): Vec2 | null =>
    v ? { x: v.x + dx, y: v.y + dy } : null;
  const anchors = sp.anchors.slice();
  anchors[index] = {
    p: world,
    hIn: shift(a.hIn),
    hOut: shift(a.hOut),
  };
  return withSubpath(shape, sub, { ...sp, anchors });
}

/**
 * Move one control handle to `world`. When `symmetric` and the opposite handle
 * exists, mirror it across the anchor to keep the node smooth.
 */
export function moveHandle(
  shape: BezierShape,
  sub: number,
  index: number,
  part: "in" | "out",
  world: Vec2,
  symmetric: boolean
): BezierShape {
  const sp = shape.subpaths[sub];
  const a = sp?.anchors[index];
  if (!a) return shape;
  const mirror: Vec2 = { x: 2 * a.p.x - world.x, y: 2 * a.p.y - world.y };
  const anchors = sp.anchors.slice();
  if (part === "out") {
    anchors[index] = {
      ...a,
      hOut: world,
      hIn: symmetric && a.hIn ? mirror : a.hIn,
    };
  } else {
    anchors[index] = {
      ...a,
      hIn: world,
      hOut: symmetric && a.hOut ? mirror : a.hOut,
    };
  }
  return withSubpath(shape, sub, { ...sp, anchors });
}
