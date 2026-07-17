import { cubicPoint, type CubicSegment } from "./bezier";
import type { BrushAnchor, BrushShape, Vec2 } from "./types";

/** Cubic segments of a brush centerline, carrying the anchor widths. */
interface BrushSegment extends CubicSegment {
  /** Width multiplier at `p0`. */
  w0: number;
  /** Width multiplier at `p1`. */
  w1: number;
}

function brushSegments(shape: BrushShape): BrushSegment[] {
  const a = shape.anchors;
  const segs: BrushSegment[] = [];
  // Brush centerlines are always open in v1: anchor i → i+1, no wrap.
  for (let i = 0; i + 1 < a.length; i++) {
    const cur = a[i];
    const next = a[i + 1];
    segs.push({
      p0: cur.p,
      c1: cur.hOut ?? cur.p,
      c2: next.hIn ?? next.p,
      p1: next.p,
      w0: cur.w,
      w1: next.w,
    });
  }
  return segs;
}

/** One sample of the flattened centerline: position and (base-scaled) width. */
interface Sample {
  p: Vec2;
  /** Half-width in local units at this sample (`strokeWidth * w / 2`). */
  r: number;
}

function flattenCenterline(shape: BrushShape, perSegment: number): Sample[] {
  const segs = brushSegments(shape);
  const halfBase = shape.strokeWidth / 2;
  if (segs.length === 0) {
    // A single anchor renders as a dot of its own width.
    const only = shape.anchors[0];
    return only ? [{ p: only.p, r: Math.max(0, halfBase * only.w) }] : [];
  }
  const samples: Sample[] = [{ p: segs[0].p0, r: Math.max(0, halfBase * segs[0].w0) }];
  for (const seg of segs) {
    for (let i = 1; i <= perSegment; i++) {
      const t = i / perSegment;
      samples.push({
        p: cubicPoint(seg, t),
        r: Math.max(0, halfBase * (seg.w0 + (seg.w1 - seg.w0) * t)),
      });
    }
  }
  return samples;
}

/** Unit normal (left of travel) at each sample, averaged across neighbours. */
function normalsFor(samples: Sample[]): Vec2[] {
  const n = samples.length;
  const normals: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = samples[Math.max(0, i - 1)].p;
    const next = samples[Math.min(n - 1, i + 1)].p;
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) {
      // Degenerate tangent (coincident neighbours): reuse the previous normal.
      normals.push(normals[i - 1] ?? { x: 0, y: -1 });
      continue;
    }
    dx /= len;
    dy /= len;
    // Left normal of travel direction (dx, dy) is (dy, -dx).
    normals.push({ x: dy, y: -dx });
  }
  return normals;
}

/**
 * Interior points of a semicircular end cap. The half-circle starts at
 * `center + normal` (radius folded into `normal`/`tangentOut`), bulges through
 * `center + tangentOut` (the outward travel direction) and ends at
 * `center − normal`. `normal` and `tangentOut` are perpendicular and equal
 * length, so `cos·normal + sin·tangentOut` traces an exact semicircle. The two
 * endpoints are omitted; the caller already emitted the left/right offsets.
 */
function semiCap(center: Vec2, normal: Vec2, tangentOut: Vec2, steps: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 1; i < steps; i++) {
    const a = (Math.PI * i) / steps;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push({
      x: center.x + c * normal.x + s * tangentOut.x,
      y: center.y + c * normal.y + s * tangentOut.y,
    });
  }
  return pts;
}

/**
 * The filled envelope ring of a brush stroke, in the shape's local space. Left
 * side forward + right side reversed + semicircular end caps make one closed
 * ring; it may self-intersect on sharp turns and is meant to be filled with the
 * nonzero winding rule. Returns `[]` for a stroke with no width or geometry.
 */
export function brushEnvelope(shape: BrushShape, perSegment = 18): Vec2[] {
  const samples = flattenCenterline(shape, perSegment);
  if (samples.length === 0) return [];
  if (samples.length === 1) {
    // Lone dot: a full circle of the sample radius.
    const { p, r } = samples[0];
    if (r < 1e-9) return [];
    const pts: Vec2[] = [];
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r });
    }
    return pts;
  }

  const normals = normalsFor(samples);
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < samples.length; i++) {
    const { p, r } = samples[i];
    const nrm = normals[i];
    left.push({ x: p.x + nrm.x * r, y: p.y + nrm.y * r });
    right.push({ x: p.x - nrm.x * r, y: p.y - nrm.y * r });
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const nFirst = normals[0];
  const nLast = normals[normals.length - 1];

  // Outward tangent = normal rotated −90°: n = (dy, −dx) ⇒ (−n.y, n.x) = (dx, dy).
  const tangentOut = (n: Vec2, r: number): Vec2 => ({ x: -n.y * r, y: n.x * r });

  const ring: Vec2[] = [];
  // Left side, start → end.
  ring.push(...left);
  // End cap: left(end) → right(end), bulging along +travel direction.
  ring.push(
    ...semiCap(
      last.p,
      { x: nLast.x * last.r, y: nLast.y * last.r },
      tangentOut(nLast, last.r),
      8
    )
  );
  // Right side, end → start.
  for (let i = right.length - 1; i >= 0; i--) ring.push(right[i]);
  // Start cap: right(start) → left(start), bulging along −travel direction.
  ring.push(
    ...semiCap(
      first.p,
      { x: -nFirst.x * first.r, y: -nFirst.y * first.r },
      tangentOut(nFirst, -first.r),
      8
    )
  );
  return ring;
}

// Envelope rings are pure functions of the (immutable) shape, so a WeakMap keyed
// on shape identity is a correct, self-invalidating cache.
const envelopeCache = new WeakMap<BrushShape, Vec2[]>();

/** Cached {@link brushEnvelope} for a committed (immutable) brush shape. */
export function cachedBrushEnvelope(shape: BrushShape): Vec2[] {
  let ring = envelopeCache.get(shape);
  if (!ring) {
    ring = brushEnvelope(shape);
    envelopeCache.set(shape, ring);
  }
  return ring;
}

/** Convenience: Catmull-Rom-free straight anchor from a point + width. */
export function brushAnchor(p: Vec2, w: number): BrushAnchor {
  return { p, hIn: null, hOut: null, w };
}

// ---- centerline sampling & fitting (shared by capture and erasing) ---------

/** A centerline sample carrying a width *multiplier* (not an absolute width). */
export interface WidthSample {
  p: Vec2;
  w: number;
}

/**
 * Flatten a brush centerline into samples carrying the width multiplier `w`
 * (so it is independent of `strokeWidth`). Used by the eraser to cut the line
 * and by the capture pipeline to fit anchors.
 */
export function brushCenterlineSamples(
  shape: BrushShape,
  perSegment = 18
): WidthSample[] {
  const segs = brushSegments(shape);
  if (segs.length === 0) {
    const only = shape.anchors[0];
    return only ? [{ p: only.p, w: only.w }] : [];
  }
  const out: WidthSample[] = [{ p: segs[0].p0, w: segs[0].w0 }];
  for (const seg of segs) {
    for (let i = 1; i <= perSegment; i++) {
      const t = i / perSegment;
      out.push({ p: cubicPoint(seg, t), w: seg.w0 + (seg.w1 - seg.w0) * t });
    }
  }
  return out;
}

/** Perpendicular distance from p to the infinite line through a, b. */
function perpDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/**
 * Ramer–Douglas–Peucker on position where the split metric also counts width
 * deviation (scaled so a `wEps` error equals a `posEps` position error), so a
 * mid-run pressure peak survives even on a straight span.
 */
export function simplifyWidthSamples(
  samples: WidthSample[],
  posEps: number,
  wEps: number
): WidthSample[] {
  const n = samples.length;
  if (n <= 2) return samples.slice();
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack: [number, number][] = [[0, n - 1]];
  const wScale = posEps / Math.max(wEps, 1e-6);
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxErr = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const t = (i - start) / (end - start);
      const perp = perpDistance(samples[i].p, samples[start].p, samples[end].p);
      const wInterp = samples[start].w + (samples[end].w - samples[start].w) * t;
      const wErr = Math.abs(samples[i].w - wInterp) * wScale;
      const err = Math.max(perp, wErr);
      if (err > maxErr) {
        maxErr = err;
        index = i;
      }
    }
    if (maxErr > posEps && index !== -1) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return samples.filter((_, i) => keep[i]);
}

/**
 * Smooth open Catmull-Rom fit (handles = ±(next − prev) / 6), carrying each
 * sample's width. Mirrors `pointsToAnchors` in `model/freehand.ts`.
 */
export function fitBrushAnchors(samples: WidthSample[]): BrushAnchor[] {
  const n = samples.length;
  const anchors: BrushAnchor[] = [];
  for (let i = 0; i < n; i++) {
    const p = samples[i].p;
    const prev = samples[i - 1]?.p ?? p;
    const next = samples[i + 1]?.p ?? p;
    const tx = (next.x - prev.x) / 6;
    const ty = (next.y - prev.y) / 6;
    anchors.push({
      p,
      hIn: { x: p.x - tx, y: p.y - ty },
      hOut: { x: p.x + tx, y: p.y + ty },
      w: samples[i].w,
    });
  }
  return anchors;
}
