import type { BezierShape, Vec2 } from "../model/types";
import { worldToScreen, type Viewport } from "../model/viewport";

export type NodePart = "anchor" | "in" | "out";

export interface NodeHit {
  part: NodePart;
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
  screen: Vec2,
  viewport: Viewport,
  grabPx = 8
): NodeHit | null {
  const near = (w: Vec2, tol: number) => {
    const s = worldToScreen(viewport, w);
    return Math.abs(s.x - screen.x) <= tol && Math.abs(s.y - screen.y) <= tol;
  };
  // Handles first.
  for (let i = 0; i < shape.anchors.length; i++) {
    const a = shape.anchors[i];
    if (a.hOut && near(a.hOut, grabPx)) return { part: "out", index: i };
    if (a.hIn && near(a.hIn, grabPx)) return { part: "in", index: i };
  }
  for (let i = 0; i < shape.anchors.length; i++) {
    if (near(shape.anchors[i].p, grabPx + 1)) return { part: "anchor", index: i };
  }
  return null;
}

/** Move an anchor point to `world`, dragging its handles along with it. */
export function moveAnchor(
  shape: BezierShape,
  index: number,
  world: Vec2
): BezierShape {
  const a = shape.anchors[index];
  const dx = world.x - a.p.x;
  const dy = world.y - a.p.y;
  const shift = (v: Vec2 | null): Vec2 | null =>
    v ? { x: v.x + dx, y: v.y + dy } : null;
  const anchors = shape.anchors.slice();
  anchors[index] = {
    p: world,
    hIn: shift(a.hIn),
    hOut: shift(a.hOut),
  };
  return { ...shape, anchors };
}

/**
 * Move one control handle to `world`. When `symmetric` and the opposite handle
 * exists, mirror it across the anchor to keep the node smooth.
 */
export function moveHandle(
  shape: BezierShape,
  index: number,
  part: "in" | "out",
  world: Vec2,
  symmetric: boolean
): BezierShape {
  const a = shape.anchors[index];
  const mirror: Vec2 = { x: 2 * a.p.x - world.x, y: 2 * a.p.y - world.y };
  const anchors = shape.anchors.slice();
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
  return { ...shape, anchors };
}
