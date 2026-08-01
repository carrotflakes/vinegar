// ===========================================================================
// Pure anchor editing shared by the node tool and the store. Everything here
// works in the shape's own local space; screen-space hit-testing and chrome
// sizes live in `canvas/nodes.ts`, which re-exports these.
// ===========================================================================

import { withSubpath } from "@/model/path/path";
import type { BrushShape, PathShape, Vec2 } from "./types";

/**
 * Shapes whose cubic anchors the node tool can edit. A brush is treated as one
 * open subpath of anchors (its per-anchor width rides along untouched).
 */
export type NodeEditShape = PathShape | BrushShape;

/** Structural read view of a single anchor, shared by bezier and brush. */
export interface EditAnchor {
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

/** Key identifying one control handle within a shape: `sub:index:in|out`. */
export function handleKey(
  sub: number,
  index: number,
  part: "in" | "out"
): string {
  return `${sub}:${index}:${part}`;
}

/**
 * The handles the node tool shows — and therefore the only ones it lets you
 * grab: the selected anchors' own handles, plus the neighbouring handles that
 * *face* them, so both sides of a segment touching the selection can be shaped.
 * A path of any size would otherwise bury itself under handle lines.
 *
 * `null` means "all of them" (the show-all preference); rendering and
 * hit-testing must read the same answer, so both go through this.
 */
export function visibleHandleKeys(
  shape: NodeEditShape,
  active: readonly { sub: number; index: number }[],
  showAll = false
): ReadonlySet<string> | null {
  if (showAll) return null;
  const keys = new Set<string>();
  const subpaths = nodeSubpaths(shape);
  for (const { sub, index } of active) {
    const subpath = subpaths[sub];
    if (!subpath?.anchors[index]) continue;
    keys.add(handleKey(sub, index, "in"));
    keys.add(handleKey(sub, index, "out"));
    const count = subpath.anchors.length;
    // On a closed subpath the ends are neighbours; on an open one they aren't.
    const previous = index > 0 ? index - 1 : subpath.closed ? count - 1 : -1;
    const next = index < count - 1 ? index + 1 : subpath.closed ? 0 : -1;
    if (previous >= 0) keys.add(handleKey(sub, previous, "out"));
    if (next >= 0) keys.add(handleKey(sub, next, "in"));
  }
  return keys;
}

function shiftV(v: Vec2 | null, dx: number, dy: number): Vec2 | null {
  return v ? { x: v.x + dx, y: v.y + dy } : null;
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
