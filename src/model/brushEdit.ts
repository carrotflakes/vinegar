import { cubicPoint, type CubicSegment } from "./path";
import type { BrushAnchor, BrushShape, Vec2 } from "./types";

// Node-tool structural edits on a brush centerline (one open run of anchors).
// These mirror the path equivalents in `path.ts` but carry each anchor's
// width multiplier `w` through splits and smoothing.

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Cubic segment anchor i → i+1 (missing handles collapse to the anchor). */
function segment(shape: BrushShape, i: number): CubicSegment {
  const cur = shape.anchors[i];
  const next = shape.anchors[i + 1];
  return {
    p0: cur.p,
    c1: cur.hOut ?? cur.p,
    c2: next.hIn ?? next.p,
    p1: next.p,
  };
}

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
  for (let si = 0; si + 1 < shape.anchors.length; si++) {
    const seg = segment(shape, si);
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

  const c1 = cur.hOut ?? cur.p;
  const c2 = next.hIn ?? next.p;
  const q0 = lerp(cur.p, c1, t);
  const q1 = lerp(c1, c2, t);
  const q2 = lerp(c2, next.p, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const s = lerp(r0, r1, t);

  anchors[segIndex] = { ...cur, hOut: q0 };
  anchors[segIndex + 1] = { ...next, hIn: q2 };
  anchors.splice(segIndex + 1, 0, { p: s, hIn: r0, hOut: r1, w });
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
    anchors[index] = { ...a, hIn: null, hOut: null };
    return { ...shape, anchors };
  }

  const prev = index > 0 ? shape.anchors[index - 1] : null;
  const next = index < n - 1 ? shape.anchors[index + 1] : null;

  let smoothed: BrushAnchor = a;
  if (prev && next) {
    const dx = next.p.x - prev.p.x;
    const dy = next.p.y - prev.p.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const inLen = Math.hypot(a.p.x - prev.p.x, a.p.y - prev.p.y) / 3;
    const outLen = Math.hypot(next.p.x - a.p.x, next.p.y - a.p.y) / 3;
    smoothed = {
      ...a,
      hIn: { x: a.p.x - ux * inLen, y: a.p.y - uy * inLen },
      hOut: { x: a.p.x + ux * outLen, y: a.p.y + uy * outLen },
    };
  } else if (next) {
    smoothed = { ...a, hOut: lerp(a.p, next.p, 1 / 3) };
  } else if (prev) {
    smoothed = { ...a, hIn: lerp(a.p, prev.p, 1 / 3) };
  }
  anchors[index] = smoothed;
  return { ...shape, anchors };
}
