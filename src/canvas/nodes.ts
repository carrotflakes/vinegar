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
import {
  handleKey,
  moveAnchor,
  moveAnchors,
  nodeSubpaths,
  visibleHandleKeys,
  type NodeEditShape,
} from "@/model/nodeEdit";
import type { PathShape, BrushShape, Matrix, Vec2 } from "../model/types";
import { worldToScreen, type Viewport } from "@/model/geometry/viewport";

export type NodePart = "anchor" | "in" | "out";

export interface NodeHit {
  part: NodePart;
  /** Index into `shape.subpaths`. */
  sub: number;
  index: number;
}

// The pure, local-space half of node editing lives in `model/nodeEdit.ts` so
// the store can nudge anchors without reaching into the canvas layer.
export {
  handleKey,
  moveAnchor,
  moveAnchors,
  nodeSubpaths,
  visibleHandleKeys,
  type NodeEditShape,
};

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
 *
 * `visibleHandles` (from `visibleHandleKeys`) restricts which handles can be
 * grabbed; null means all of them. The overlay is drawn from the same set, so
 * a handle that isn't shown is never picked up by accident.
 */
export function hitNodes(
  shape: NodeEditShape,
  transform: Matrix,
  screen: Vec2,
  viewport: Viewport,
  grabPx = 8,
  preferAnchors = false,
  visibleHandles: ReadonlySet<string> | null = null
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
        const shown = (part: "in" | "out") =>
          !visibleHandles || visibleHandles.has(handleKey(sub, i, part));
        if (a.hOut && shown("out") && near(a.hOut, grabPx))
          return { part: "out", sub, index: i };
        if (a.hIn && shown("in") && near(a.hIn, grabPx))
          return { part: "in", sub, index: i };
      }
    }
    return null;
  };
  return preferAnchors ? hitAnchor() ?? hitHandle() : hitHandle() ?? hitAnchor();
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
