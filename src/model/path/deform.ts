import { distance } from "@/model/geometry/vec";
import type { PathSubpath, Vec2 } from "../types";
import { pointsToAnchors } from "./freehand";
import { flattenSubpathAdaptive } from "./path";

/** Flatness used when measuring a contour before resampling it. */
const FLATNESS = 0.2;
/** Upper bound on generated points per contour, so a tiny spacing can't hang. */
const MAX_POINTS = 4000;
interface Sample {
  p: Vec2;
  /** Unit normal (left of the direction of travel). */
  n: Vec2;
}

/**
 * Walk a contour at even arc-length steps. The step is adjusted so a whole
 * number of them spans the contour — a wave has to meet itself at the seam of
 * a closed path, and an open path has to land exactly on its far endpoint.
 * `multiple` forces that count to a multiple of it (2 for an alternating
 * zig zag, whose period is two steps).
 */
function resample(
  subpath: PathSubpath,
  spacing: number,
  multiple = 1
): Sample[] | null {
  const points = flattenSubpathAdaptive(subpath, FLATNESS);
  if (points.length < 2) return null;
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
  }
  const total = cumulative[cumulative.length - 1];
  if (!(total > 0) || !(spacing > 0)) return null;
  const wanted = Math.max(multiple, Math.round(total / spacing / multiple) * multiple);
  const steps = Math.min(wanted, Math.floor(MAX_POINTS / multiple) * multiple);
  const step = total / steps;
  // A closed contour's last sample would land back on the first one.
  const count = subpath.closed ? steps : steps + 1;
  const samples: Sample[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = Math.min(i * step, total);
    while (cursor < cumulative.length - 2 && cumulative[cursor + 1] < target) cursor++;
    const span = cumulative[cursor + 1] - cumulative[cursor];
    const t = span > 0 ? (target - cumulative[cursor]) / span : 0;
    const a = points[cursor];
    const b = points[cursor + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    samples.push({
      p: { x: a.x + dx * t, y: a.y + dy * t },
      n: { x: -dy / length, y: dx / length },
    });
  }
  return samples;
}

/**
 * Turn a point list back into a contour, either straight or Catmull-Rom.
 * The smooth form goes through `pointsToAnchors`, the same fit the pencil and
 * brush use: it clamps each handle so it cannot overshoot its neighbour, which
 * matters here because displaced samples are no longer evenly spaced.
 */
function fromPoints(points: Vec2[], closed: boolean, smooth: boolean): PathSubpath {
  return {
    closed,
    anchors: smooth
      ? pointsToAnchors(points, closed)
      : points.map((p) => ({ p, hIn: null, hOut: null })),
  };
}

/**
 * Push every sample sideways by `amplitude`, flipping sign each step, so one
 * period spans two steps. `smooth` rounds the ridges into a wave.
 */
export function zigzagSubpaths(
  subpaths: PathSubpath[],
  amplitude: number,
  wavelength: number,
  style: "corner" | "smooth"
): PathSubpath[] {
  if (!amplitude || !(wavelength > 0)) return subpaths;
  return subpaths.map((subpath) => {
    const samples = resample(subpath, wavelength / 2, 2);
    if (!samples) return subpath;
    const last = samples.length - 1;
    const points = samples.map((sample, i) => {
      // An open contour keeps its endpoints, the way a stroke stays anchored.
      if (!subpath.closed && (i === 0 || i === last)) return sample.p;
      const offset = i % 2 === 0 ? amplitude : -amplitude;
      return {
        x: sample.p.x + sample.n.x * offset,
        y: sample.p.y + sample.n.y * offset,
      };
    });
    return fromPoints(points, subpath.closed, style === "smooth");
  });
}

/** Deterministic [0, 1) noise from three integers (mulberry32 on a hash). */
function noise(seed: number, contour: number, index: number): number {
  let t = (Math.imul(seed | 0, 374761393) + Math.imul(contour, 668265263) +
    Math.imul(index, 2654435761) + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Displace every sample by up to `size` in a random direction. `seed` keeps a
 * given roughening stable — the same document always paints the same wobble,
 * and nudging `size` shakes the same set of points rather than reshuffling
 * them.
 */
export function roughenSubpaths(
  subpaths: PathSubpath[],
  size: number,
  detail: number,
  seed: number,
  style: "corner" | "smooth"
): PathSubpath[] {
  if (!(size > 0) || !(detail > 0)) return subpaths;
  return subpaths.map((subpath, contour) => {
    const samples = resample(subpath, detail);
    if (!samples) return subpath;
    const last = samples.length - 1;
    const points = samples.map((sample, i) => {
      if (!subpath.closed && (i === 0 || i === last)) return sample.p;
      const angle = noise(seed, contour, i * 2) * Math.PI * 2;
      const distance = noise(seed, contour, i * 2 + 1) * size;
      return {
        x: sample.p.x + Math.cos(angle) * distance,
        y: sample.p.y + Math.sin(angle) * distance,
      };
    });
    return fromPoints(points, subpath.closed, style === "smooth");
  });
}
