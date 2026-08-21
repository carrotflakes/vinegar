import { brushSegments } from "./brushSegments";
import { cubicPoint } from "@/model/path/path";
import { setAnchorType } from "@/model/path/anchorType";
import { lerp } from "@/model/geometry/vec";
import { splitCubic } from "@/model/path/measure";
import type { BrushShape, Vec2 } from "../types";

// Node-tool structural edits on a brush centerline (one open run of anchors).
// These mirror the path equivalents in `path.ts` but carry each anchor's
// width multiplier `w` through splits and smoothing.

export interface BrushLocation {
  /** Segment index; segment i runs anchor i → i+1. */
  segIndex: number;
  /** Parameter within the segment, in [0, 1]. */
  t: number;
  point: Vec2;
  distance: number;
}

/**
 * Closest point on the brush centerline to `p` (coarse sampling refined by a
 * ternary search), used to place an inserted anchor. Null when there are no
 * segments.
 */
export function closestPointOnBrush(shape: BrushShape, p: Vec2): BrushLocation | null {
  let best: BrushLocation | null = null;
  const COARSE = 20;
  const segments = brushSegments(shape);
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const distAt = (t: number) => {
      const q = cubicPoint(seg, t);
      return Math.hypot(q.x - p.x, q.y - p.y);
    };
    let bt = 0;
    let bd = Infinity;
    for (let i = 0; i <= COARSE; i++) {
      const t = i / COARSE;
      const d = distAt(t);
      if (d < bd) {
        bd = d;
        bt = t;
      }
    }
    let lo = Math.max(0, bt - 1 / COARSE);
    let hi = Math.min(1, bt + 1 / COARSE);
    for (let iter = 0; iter < 24; iter++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (distAt(m1) < distAt(m2)) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    const point = cubicPoint(seg, t);
    const distance = Math.hypot(point.x - p.x, point.y - p.y);
    if (!best || distance < best.distance) {
      best = { segIndex: si, t, point, distance };
    }
  }
  return best;
}

/**
 * Insert an anchor at parameter `t` of segment `segIndex` without changing the
 * curve (de Casteljau subdivision). The new anchor's width is the linear
 * interpolation of its neighbours' widths, matching how the envelope samples w.
 */
export function insertBrushAnchor(
  shape: BrushShape,
  segIndex: number,
  t: number
): BrushShape {
  const anchors = shape.anchors.slice();
  const cur = anchors[segIndex];
  const next = anchors[segIndex + 1];
  if (!cur || !next) return shape;
  const w = cur.w + (next.w - cur.w) * t;

  if (!cur.hOut && !next.hIn) {
    anchors.splice(segIndex + 1, 0, {
      p: lerp(cur.p, next.p, t),
      hIn: null,
      hOut: null,
      w,
    });
    return { ...shape, anchors };
  }

  const [left, right] = splitCubic({
    p0: cur.p,
    c1: cur.hOut ?? cur.p,
    c2: next.hIn ?? next.p,
    p1: next.p,
  }, t);

  anchors[segIndex] = {
    ...cur,
    hOut: left.c1,
    ...(cur.t === "symmetric" ? { t: "smooth" as const } : {}),
  };
  anchors[segIndex + 1] = {
    ...next,
    hIn: right.c2,
    ...(next.t === "symmetric" ? { t: "smooth" as const } : {}),
  };
  anchors.splice(segIndex + 1, 0, { p: left.p1, hIn: left.c2, hOut: right.c1, w });
  return { ...shape, anchors };
}

/**
 * Remove one anchor. Returns null when fewer than two anchors would remain
 * (the caller then deletes the whole brush).
 */
export function deleteBrushAnchor(shape: BrushShape, index: number): BrushShape | null {
  if (index < 0 || index >= shape.anchors.length) return shape;
  const anchors = shape.anchors.filter((_, i) => i !== index);
  return anchors.length < 2 ? null : { ...shape, anchors };
}

/**
 * Toggle an anchor between a sharp corner (no handles) and a smooth point.
 * Smoothing derives handles from the neighbours (Catmull-Rom style); the open
 * ends get a single handle toward their only neighbour. Width is preserved.
 */
export function toggleBrushAnchorSmooth(shape: BrushShape, index: number): BrushShape {
  const n = shape.anchors.length;
  const a = shape.anchors[index];
  if (!a) return shape;
  const anchors = shape.anchors.slice();

  if (a.hIn || a.hOut) {
    anchors[index] = setAnchorType(
      { ...a, hIn: null, hOut: null },
      "cusp"
    );
    return { ...shape, anchors };
  }

  const prev = index > 0 ? shape.anchors[index - 1] : null;
  const next = index < n - 1 ? shape.anchors[index + 1] : null;

  anchors[index] = setAnchorType(a, "smooth", prev, next);
  return { ...shape, anchors };
}
