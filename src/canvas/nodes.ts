import { withSubpath } from "@/model/path/path";
import {
  deriveAnchorType,
  effectiveAnchorType,
} from "@/model/path/anchorType";
import { applyMatrix, matrixScale } from "@/model/geometry/matrix";
import {
  brushAnchorNormal,
  brushAnchorRadius,
} from "@/model/brush/brushWidth";
import type { PathShape, BrushShape, Matrix, Vec2 } from "../model/types";
import { worldToScreen, type Viewport } from "@/model/geometry/viewport";

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
export const WIDTH_KNOB = 8;
/**
 * A knob never sits closer to its anchor than this, so a hairline (or
 * zero-width) anchor still has something to grab clear of its anchor square.
 * Only the drawn/hit position is nudged out; the width a drag produces is
 * always read from the real distance.
 */
export const WIDTH_KNOB_MIN_PX = 7;

/** One grabbable width knob of a brush anchor, in screen space. */
export interface WidthKnob {
  index: number;
  /** +1 on the left normal, −1 on the right; both edit the same `w`. */
  side: 1 | -1;
  screen: Vec2;
  anchorScreen: Vec2;
}

/**
 * Width knobs for the *selected* anchors of a brush. Restricted to the
 * selection on purpose: a fitted freehand stroke has dozens of anchors, and
 * knobs on all of them would bury the stroke.
 */
export function brushWidthKnobs(
  shape: BrushShape,
  transform: Matrix,
  viewport: Viewport,
  active: readonly number[],
  minOffsetPx = WIDTH_KNOB_MIN_PX
): WidthKnob[] {
  const toS = (w: Vec2) => worldToScreen(viewport, applyMatrix(transform, w));
  // Local units per screen pixel, so the minimum offset is a screen distance.
  const perPx = 1 / Math.max(1e-9, matrixScale(transform) * viewport.scale);
  const knobs: WidthKnob[] = [];
  for (const index of new Set(active)) {
    const anchor = shape.anchors[index];
    if (!anchor) continue;
    const normal = brushAnchorNormal(shape, index);
    const r = Math.max(brushAnchorRadius(shape, index), minOffsetPx * perPx);
    const anchorScreen = toS(anchor.p);
    for (const side of [1, -1] as const) {
      knobs.push({
        index,
        side,
        anchorScreen,
        screen: toS({
          x: anchor.p.x + normal.x * r * side,
          y: anchor.p.y + normal.y * r * side,
        }),
      });
    }
  }
  return knobs;
}

/** Hit-test the width knobs of the selected brush anchors. */
export function hitBrushWidth(
  shape: BrushShape,
  transform: Matrix,
  screen: Vec2,
  viewport: Viewport,
  active: readonly number[],
  grabPx = 8
): WidthKnob | null {
  let best: WidthKnob | null = null;
  let bestDistance = grabPx;
  for (const knob of brushWidthKnobs(shape, transform, viewport, active)) {
    const d = Math.hypot(knob.screen.x - screen.x, knob.screen.y - screen.y);
    if (d <= bestDistance) {
      best = knob;
      bestDistance = d;
    }
  }
  return best;
}

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
 * Move one control handle according to the anchor's effective linkage type.
 * Alt-style breaking writes a persistent cusp tag.
 */
export function moveHandle(
  shape: NodeEditShape,
  sub: number,
  index: number,
  part: "in" | "out",
  world: Vec2,
  breakSymmetry: boolean
): NodeEditShape {
  const anchorsOf = shape.type === "brush" ? shape.anchors : shape.subpaths[sub]?.anchors;
  const a = anchorsOf?.[index];
  if (!a || !anchorsOf) return shape;
  const type = breakSymmetry ? "cusp" : effectiveAnchorType(a);
  const dx = world.x - a.p.x;
  const dy = world.y - a.p.y;
  const draggedLength = Math.hypot(dx, dy);
  const mirror: Vec2 = { x: a.p.x - dx, y: a.p.y - dy };
  const anchors = anchorsOf.slice();
  let moved = { ...a };
  if (part === "out") {
    let hIn = a.hIn;
    if (type === "symmetric" && hIn) {
      hIn = mirror;
    } else if (type === "smooth" && hIn && draggedLength > 0) {
      const oppositeLength = Math.hypot(hIn.x - a.p.x, hIn.y - a.p.y);
      hIn = {
        x: a.p.x - (dx / draggedLength) * oppositeLength,
        y: a.p.y - (dy / draggedLength) * oppositeLength,
      };
    }
    moved = { ...a, hOut: world, hIn };
  } else {
    let hOut = a.hOut;
    if (type === "symmetric" && hOut) {
      hOut = mirror;
    } else if (type === "smooth" && hOut && draggedLength > 0) {
      const oppositeLength = Math.hypot(hOut.x - a.p.x, hOut.y - a.p.y);
      hOut = {
        x: a.p.x - (dx / draggedLength) * oppositeLength,
        y: a.p.y - (dy / draggedLength) * oppositeLength,
      };
    }
    moved = { ...a, hIn: world, hOut };
  }
  // `moved` already carries `a.t`; only pin a tag when the drag would otherwise
  // change the linkage the geometry derives to.
  if (breakSymmetry) moved = { ...moved, t: "cusp" };
  else if (!a.t && deriveAnchorType(moved) !== type) moved = { ...moved, t: type };
  anchors[index] = moved;
  if (shape.type === "brush") return { ...shape, anchors: anchors as BrushShape["anchors"] };
  return withSubpath(shape, sub, { ...shape.subpaths[sub], anchors: anchors as PathShape["subpaths"][number]["anchors"] });
}
