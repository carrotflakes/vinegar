// ===========================================================================
// Gradients — geometry, stops and the two pure conversions every consumer
// shares (canvas styles, SVG defs, CSS previews).
//
// A gradient is modelled as a *unit-space* ramp plus a matrix:
//
//   linear  t = x of the unit square, running (0,0) → (1,0)
//   radial  t = distance from the origin, 1 at the unit circle
//   conic   t = angle around the origin, 0 at +x, one turn = 1
//
// {@link gradientMatrix} maps that unit space into the shape's local space. All
// the placement knobs (start/end points, ellipse ratio, bounds-relative vs
// pinned) fold into that one matrix, so a renderer only has to know how to draw
// the three unit ramps and how to apply a matrix — and SVG gets it for free via
// `gradientTransform`. Anything a Canvas/SVG ramp cannot express natively
// (stop midpoints, non-sRGB interpolation) is baked into extra stops by
// {@link renderStops} so every backend shows the same colours.
// ===========================================================================

import { mixHex, rgba, type InterpolationSpace } from "./color";
import { applyMatrix, invertMatrix } from "./geometry/matrix";
import { type Bounds, type Matrix, makeId, type Vec2 } from "./types";

export type GradientKind = "linear" | "radial" | "conic";

/**
 * Which space {@link GradientPaint.start}/`end` are given in:
 * - `bounds`: 0..1 of the shape's fill bounds — the gradient follows a resize
 *   (and is squashed with it, like Figma / SVG `objectBoundingBox`).
 * - `local`: shape-local user units — the gradient stays put when the shape is
 *   resized or reshaped (like Illustrator's annotator).
 */
export type GradientSpace = "bounds" | "local";

/** What happens outside the 0..1 ramp (SVG `spreadMethod`). Conic ignores it. */
export type GradientSpread = "pad" | "repeat" | "reflect";

/** One colour stop. `offset` is 0..1 along the ramp. */
export interface GradientStop {
  /** Stable identity, so dragging a stop past its neighbour can't swap it. */
  id: string;
  offset: number;
  color: string;
  alpha: number;
  /**
   * Where the blend to the *next* stop reaches its halfway colour, as a
   * fraction of the gap (0.5 = an even blend). Illustrator's diamond marker.
   * Ignored on the last stop.
   */
  midpoint: number;
}

export interface GradientPaint {
  type: "gradient";
  kind: GradientKind;
  space: GradientSpace;
  /** linear: ramp start. radial/conic: centre. In {@link GradientSpace}. */
  start: Vec2;
  /** linear: ramp end. radial: the unit-circle point. conic: 0° direction. */
  end: Vec2;
  /** Second axis of a radial/conic ellipse, as a fraction of `start`→`end`. */
  ratio: number;
  /** Radial focal point, in unit-circle coordinates (0,0 = centre). */
  focal: Vec2;
  spread: GradientSpread;
  interpolation: InterpolationSpace;
  stops: GradientStop[];
  /** 0..1 opacity of the whole paint, on top of each stop's alpha. */
  alpha: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A degenerate second axis would make the gradient matrix non-invertible. */
const MIN_RATIO = 0.01;
const MAX_RATIO = 100;

export function gradientStop(
  color: string,
  offset: number,
  opts: { alpha?: number; midpoint?: number } = {}
): GradientStop {
  return {
    id: makeId("stop"),
    offset: clamp01(offset),
    color,
    alpha: clamp01(opts.alpha ?? 1),
    midpoint: clamp(opts.midpoint ?? 0.5, 0.001, 0.999),
  };
}

/** A gradient over the shape's bounds; geometry defaults to the kind's. */
export function gradient(
  stops: GradientStop[],
  opts: Partial<Omit<GradientPaint, "type" | "stops">> = {}
): GradientPaint {
  const kind = opts.kind ?? "linear";
  const geometry = defaultGeometry(kind);
  return {
    type: "gradient",
    kind,
    space: opts.space ?? "bounds",
    start: opts.start ?? geometry.start,
    end: opts.end ?? geometry.end,
    ratio: clamp(opts.ratio ?? 1, MIN_RATIO, MAX_RATIO),
    focal: opts.focal ?? { x: 0, y: 0 },
    spread: opts.spread ?? "pad",
    interpolation: opts.interpolation ?? "srgb",
    stops,
    alpha: clamp01(opts.alpha ?? 1),
  };
}

/** Default geometry for a `kind`, in bounds space (radial/conic sit centred). */
export function defaultGeometry(kind: GradientKind): Pick<GradientPaint, "start" | "end"> {
  if (kind === "linear") return { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } };
  return { start: { x: 0.5, y: 0.5 }, end: { x: 1, y: 0.5 } };
}

export function isGradientPaint(paint: { type: string } | null | undefined): paint is GradientPaint {
  return !!paint && paint.type === "gradient";
}

/** Stops in ascending offset order (every backend needs monotonic offsets). */
export function sortedStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.offset - b.offset);
}

// ---------------------------------------------------------------------------
// Editing helpers — shared by the panel and the on-canvas gradient tool, so
// both produce exactly the same edits.
// ---------------------------------------------------------------------------

/** Direction of the first axis, in the paint's own space (radians, y-down). */
export function gradientAngle(paint: GradientPaint): number {
  return Math.atan2(paint.end.y - paint.start.y, paint.end.x - paint.start.x);
}

/** Length of the first axis, in the paint's own space. */
export function gradientLength(paint: GradientPaint): number {
  return Math.hypot(paint.end.x - paint.start.x, paint.end.y - paint.start.y);
}

/**
 * Re-lay the first axis. A linear ramp keeps its middle put (spinning it feels
 * like turning the whole shape's fill); radial and conic keep their centre,
 * which is where `start` already is.
 */
function withAxis(paint: GradientPaint, angle: number, length: number): GradientPaint {
  const d = { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
  if (paint.kind !== "linear") {
    return { ...paint, end: { x: paint.start.x + d.x, y: paint.start.y + d.y } };
  }
  const mid = {
    x: (paint.start.x + paint.end.x) / 2,
    y: (paint.start.y + paint.end.y) / 2,
  };
  return {
    ...paint,
    start: { x: mid.x - d.x / 2, y: mid.y - d.y / 2 },
    end: { x: mid.x + d.x / 2, y: mid.y + d.y / 2 },
  };
}

export function withGradientAngle(paint: GradientPaint, angle: number): GradientPaint {
  return withAxis(paint, angle, gradientLength(paint) || 1);
}

export function withGradientLength(paint: GradientPaint, length: number): GradientPaint {
  return withAxis(paint, gradientAngle(paint), Math.max(length, 1e-4));
}

/** Mirror the ramp end for end (colours only — the geometry stays put). */
export function reverseStops(paint: GradientPaint): GradientPaint {
  const stops = sortedStops(paint.stops);
  return {
    ...paint,
    stops: stops.map((s, i) => ({
      ...s,
      offset: clamp01(1 - s.offset),
      // The gap a midpoint describes now belongs to the other neighbour.
      midpoint: 1 - (stops[stops.length - 2 - i]?.midpoint ?? 0.5),
    })).reverse(),
  };
}

/** Insert a stop at `offset`, taking the colour the ramp already has there. */
export function addStopAt(paint: GradientPaint, offset: number): {
  paint: GradientPaint;
  stop: GradientStop;
} {
  const at = sampleRamp(renderStops({ ...paint, alpha: 1 }), offset);
  const stop = gradientStop(at.color, offset, { alpha: at.alpha });
  return { paint: { ...paint, stops: [...paint.stops, stop] }, stop };
}

export function updateStop(
  paint: GradientPaint,
  id: string,
  patch: Partial<Omit<GradientStop, "id">>
): GradientPaint {
  return {
    ...paint,
    stops: paint.stops.map((s) =>
      s.id === id
        ? {
            ...s,
            ...patch,
            offset: clamp01(patch.offset ?? s.offset),
            midpoint: clamp(patch.midpoint ?? s.midpoint, 0.001, 0.999),
          }
        : s
    ),
  };
}

/**
 * Switch between bounds-relative and pinned placement without moving the
 * gradient: the points are converted through the shape's fill bounds. Without
 * bounds (a "new shape defaults" field has no shape) the geometry is reset.
 */
export function withGradientSpace(
  paint: GradientPaint,
  space: GradientSpace,
  bounds: Bounds | null
): GradientPaint {
  if (paint.space === space) return paint;
  if (!bounds || bounds.width === 0 || bounds.height === 0) {
    return { ...paint, space, ...defaultGeometry(paint.kind) };
  }
  const m = boundsMatrix(bounds);
  const inv = invertMatrix(m);
  if (!inv) return { ...paint, space, ...defaultGeometry(paint.kind) };
  const convert = space === "local" ? m : inv;
  return {
    ...paint,
    space,
    start: applyMatrix(convert, paint.start),
    end: applyMatrix(convert, paint.end),
  };
}

/** Remove a stop; a gradient always keeps at least two. */
export function removeStop(paint: GradientPaint, id: string): GradientPaint {
  if (paint.stops.length <= 2) return paint;
  return { ...paint, stops: paint.stops.filter((s) => s.id !== id) };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Maps the 0..1 unit square onto `bounds`. */
function boundsMatrix(bounds: Bounds): Matrix {
  return [bounds.width, 0, 0, bounds.height, bounds.x, bounds.y];
}

/**
 * The matrix taking unit gradient space to the shape's local space. `bounds`
 * are the shape's fill bounds; they are only read for `space: "bounds"`.
 *
 * Columns are the two gradient axes: the first runs `start`→`end`, the second
 * is its perpendicular scaled by `ratio` — both mapped through the space, so a
 * bounds-relative gradient on a non-square shape stretches with it.
 */
export function gradientMatrix(paint: GradientPaint, bounds: Bounds): Matrix {
  const toLocal = paint.space === "bounds" ? boundsMatrix(bounds) : null;
  const map = (p: Vec2) => (toLocal ? applyMatrix(toLocal, p) : p);
  // A linear ramp only cares about the direction of its iso-lines, so its
  // second axis is fixed at 1 — `ratio` would only rescale an unused axis.
  const r = paint.kind === "linear" ? 1 : clamp(paint.ratio, MIN_RATIO, MAX_RATIO);
  const d = { x: paint.end.x - paint.start.x, y: paint.end.y - paint.start.y };
  const o = map(paint.start);
  const ax = map(paint.end);
  const ay = map({ x: paint.start.x - d.y * r, y: paint.start.y + d.x * r });
  return [ax.x - o.x, ax.y - o.y, ay.x - o.x, ay.y - o.y, o.x, o.y];
}

/**
 * Whether a gradient matrix is a similarity (rotation, uniform scale, flip):
 * radial and conic ramps can then be drawn with the native Canvas/CSS calls,
 * because their circles stay circles. Otherwise the caller has to transform.
 */
export function isSimilarity(m: Matrix): boolean {
  const [a, b, c, d] = m;
  const s1 = Math.hypot(a, b);
  const s2 = Math.hypot(c, d);
  if (s1 < 1e-9 || s2 < 1e-9) return false;
  // Axes of equal length and perpendicular.
  return Math.abs(s1 - s2) < 1e-6 * s1 && Math.abs(a * c + b * d) < 1e-6 * s1 * s2;
}

/**
 * The two Canvas endpoints for a linear ramp in local space. A linear gradient
 * survives any affine map (its iso-lines stay parallel lines), so this works
 * even when the matrix squashes or shears.
 */
export function linearEndpoints(m: Matrix): { from: Vec2; to: Vec2 } | null {
  const inv = invertMatrix(m);
  if (!inv) return null;
  // t(p) = (inv · p).x, i.e. an affine function whose gradient is inv's first row.
  const g = { x: inv[0], y: inv[2] };
  const len2 = g.x * g.x + g.y * g.y;
  if (len2 < 1e-18) return null;
  const from = { x: m[4], y: m[5] }; // t = 0
  return { from, to: { x: from.x + g.x / len2, y: from.y + g.y / len2 } };
}

/** The unit-space box that covers `bounds` — how far the ramp must reach. */
export function unitCoverage(m: Matrix, bounds: Bounds): Bounds | null {
  const inv = invertMatrix(m);
  if (!inv) return null;
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((p) => applyMatrix(inv, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------

/** A stop as handed to a backend: no midpoint, no interpolation to think about. */
export interface RenderStop {
  offset: number;
  color: string;
  alpha: number;
}

/** Samples inserted per segment that a backend cannot interpolate itself. */
const SEGMENT_SAMPLES = 16;

/**
 * Expand a paint's stops into a plain ramp: sorted, with `alpha` folded in and
 * with extra samples wherever the segment's midpoint is off-centre or the
 * interpolation space isn't sRGB (neither of which Canvas or SVG can do).
 */
export function renderStops(paint: GradientPaint): RenderStop[] {
  const stops = sortedStops(paint.stops);
  const bake = (s: GradientStop): RenderStop => ({
    offset: clamp01(s.offset),
    color: s.color,
    alpha: clamp01(s.alpha),
  });
  if (stops.length === 0) return [];
  const out: RenderStop[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    out.push(bake(a));
    const even = Math.abs(a.midpoint - 0.5) < 1e-4;
    if (even && paint.interpolation === "srgb") continue;
    const gap = clamp01(b.offset) - clamp01(a.offset);
    if (gap <= 1e-6) continue;
    // midpoint m means the blend is 50% at t = m: u = t^(ln .5 / ln m).
    const exp = even ? 1 : Math.log(0.5) / Math.log(clamp(a.midpoint, 0.001, 0.999));
    for (let k = 1; k < SEGMENT_SAMPLES; k++) {
      const t = k / SEGMENT_SAMPLES;
      const u = exp === 1 ? t : Math.pow(t, exp);
      out.push({
        offset: clamp01(a.offset) + gap * t,
        color: mixHex(a.color, b.color, u, paint.interpolation),
        alpha: a.alpha + (b.alpha - a.alpha) * u,
      });
    }
  }
  out.push(bake(stops[stops.length - 1]!));
  if (paint.alpha >= 1) return out;
  return out.map((s) => ({ ...s, alpha: clamp01(s.alpha * paint.alpha) }));
}

/** How many whole ramp cycles a `spread` must cover to fill `[tMin, tMax]`. */
export function cycleRange(
  tMin: number,
  tMax: number,
  spread: GradientSpread,
  max = 32
): { from: number; to: number } {
  if (spread === "pad") return { from: 0, to: 1 };
  const from = Math.max(-max, Math.floor(Math.min(tMin, 0)));
  const to = Math.min(max, Math.ceil(Math.max(tMax, 1)));
  return { from, to: Math.max(to, from + 1) };
}

/**
 * Lay `stops` (a 0..1 ramp) repeatedly across the cycle range, remapped back
 * onto 0..1 so a native pad ramp spanning that range reproduces the spread.
 * `reflect` mirrors every odd cycle.
 */
export function tiledStops(
  stops: RenderStop[],
  spread: GradientSpread,
  range: { from: number; to: number }
): RenderStop[] {
  const span = range.to - range.from;
  if (spread === "pad" || span <= 0 || stops.length === 0) return stops;
  const out: RenderStop[] = [];
  for (let i = range.from; i < range.to; i++) {
    const flip = spread === "reflect" && Math.abs(i % 2) === 1;
    const cycle = flip
      ? [...stops].reverse().map((s) => ({ ...s, offset: 1 - s.offset }))
      : stops;
    for (const s of cycle) {
      const offset = (i - range.from + s.offset) / span;
      // Skip the duplicate that every cycle boundary would otherwise emit.
      if (out.length && Math.abs(out[out.length - 1]!.offset - offset) < 1e-9) continue;
      out.push({ ...s, offset: clamp01(offset) });
    }
  }
  return out;
}

/** The ramp colour at `t` (0..1), clamped at both ends. */
export function sampleRamp(stops: RenderStop[], t: number): RenderStop {
  if (stops.length === 0) return { offset: t, color: "#000000", alpha: 0 };
  const u = clamp01(t);
  let prev = stops[0]!;
  if (u <= prev.offset) return { ...prev, offset: u };
  for (const s of stops) {
    if (s.offset >= u) {
      const gap = s.offset - prev.offset;
      const f = gap <= 1e-9 ? 0 : (u - prev.offset) / gap;
      return {
        offset: u,
        // The ramp is already expanded, so a plain sRGB mix is correct here.
        color: mixHex(prev.color, s.color, f, "srgb"),
        alpha: prev.alpha + (s.alpha - prev.alpha) * f,
      };
    }
    prev = s;
  }
  return { ...prev, offset: u };
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

/** Wedges per turn used to fake a conic gradient, which SVG has no def for. */
const CONIC_WEDGES = 180;

/**
 * The `<defs>` entry for a gradient, in the shape's local coordinates. Linear
 * and radial map exactly (`gradientTransform` is the unit-space matrix, which
 * is what SVG's own model wants); conic has no SVG paint server, so it is
 * approximated by a one-tile `<pattern>` of flat wedges.
 */
export function gradientToSvgDef(paint: GradientPaint, id: string, bounds: Bounds): string {
  const m = gradientMatrix(paint, bounds);
  const ramp = renderStops(paint);
  if (paint.kind === "conic") return conicToSvgPattern(ramp, m, id, bounds);
  const stops = ramp
    .map(
      (s) =>
        `<stop offset="${round(s.offset)}" stop-color="${s.color}"` +
        (s.alpha < 1 ? ` stop-opacity="${round(s.alpha)}"` : "") +
        `/>`
    )
    .join("");
  const shared =
    `gradientUnits="userSpaceOnUse" gradientTransform="matrix(${m.map(round).join(",")})"` +
    (paint.spread === "pad" ? "" : ` spreadMethod="${paint.spread}"`);
  if (paint.kind === "linear") {
    return (
      `<linearGradient id="${id}" ${shared} x1="0" y1="0" x2="1" y2="0">` +
      `${stops}</linearGradient>`
    );
  }
  const focal =
    paint.focal.x || paint.focal.y
      ? ` fx="${round(paint.focal.x)}" fy="${round(paint.focal.y)}"`
      : "";
  return (
    `<radialGradient id="${id}" ${shared} cx="0" cy="0" r="1"${focal}>` +
    `${stops}</radialGradient>`
  );
}

function conicToSvgPattern(
  ramp: RenderStop[],
  m: Matrix,
  id: string,
  bounds: Bounds
): string {
  const cover = unitCoverage(m, bounds);
  const radius = cover
    ? Math.hypot(
        Math.max(Math.abs(cover.x), Math.abs(cover.x + cover.width)),
        Math.max(Math.abs(cover.y), Math.abs(cover.y + cover.height))
      ) * 1.05
    : 2;
  const wedges: string[] = [];
  for (let i = 0; i < CONIC_WEDGES; i++) {
    const a0 = (i / CONIC_WEDGES) * Math.PI * 2;
    // Overlap by one step so antialiasing can't leave hairlines between wedges.
    const a1 = ((i + 1.5) / CONIC_WEDGES) * Math.PI * 2;
    const s = sampleRamp(ramp, (i + 0.5) / CONIC_WEDGES);
    const p0 = { x: Math.cos(a0) * radius, y: Math.sin(a0) * radius };
    const p1 = { x: Math.cos(a1) * radius, y: Math.sin(a1) * radius };
    wedges.push(
      `<path d="M0 0L${round(p0.x)} ${round(p0.y)}A${round(radius)} ${round(radius)} 0 0 1 ` +
        `${round(p1.x)} ${round(p1.y)}Z" fill="${s.color}"` +
        (s.alpha < 1 ? ` fill-opacity="${round(s.alpha)}"` : "") +
        `/>`
    );
  }
  // Pattern content is placed relative to the tile's origin, so undo it first.
  const place = `translate(${round(-bounds.x)},${round(-bounds.y)}) matrix(${m.map(round).join(",")})`;
  // Antialiased wedge edges would leave hairline seams between the slices; the
  // outer rim is clipped by the shape anyway, so nothing needs smoothing here.
  return (
    `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${round(bounds.x)}" y="${round(bounds.y)}" ` +
    `width="${round(bounds.width)}" height="${round(bounds.height)}">` +
    `<g transform="${place}" shape-rendering="crispEdges">${wedges.join("")}</g></pattern>`
  );
}

// ---------------------------------------------------------------------------
// CSS previews
// ---------------------------------------------------------------------------

const round = (n: number) => parseFloat(n.toFixed(4)).toString();

const rgbaOf = (s: RenderStop) => rgba(s.color, Number(round(s.alpha)));

/** `color stop%` list shared by all the CSS previews. */
export function cssStops(paint: GradientPaint): string {
  return renderStops(paint)
    .map((s) => `${rgbaOf(s)} ${round(s.offset * 100)}%`)
    .join(", ");
}

/**
 * A CSS approximation for swatches and previews: the ramp's own direction, but
 * always across the preview box (there are no shape bounds here).
 */
export function gradientToCss(paint: GradientPaint): string {
  const stops = cssStops(paint);
  const deg = Math.round(
    (Math.atan2(paint.end.y - paint.start.y, paint.end.x - paint.start.x) * 180) / Math.PI + 90
  );
  if (paint.kind === "linear") return `linear-gradient(${deg}deg, ${stops})`;
  if (paint.kind === "conic") return `conic-gradient(from ${deg - 90}deg, ${stops})`;
  return `radial-gradient(circle, ${stops})`;
}

/** A left→right bar of the ramp, for the stop editor's track. */
export function stopsToCssBar(paint: GradientPaint): string {
  return `linear-gradient(to right, ${cssStops(paint)})`;
}
