// ===========================================================================
// Freeform gradients — a paint defined by *scattered colour points* rather
// than a ramp. The colour at a position is an interpolation of every point,
// weighted by distance (scattered data interpolation):
//
//   shepard   w = weight / dᵖ            — inverse distance weighting; the
//                                          field passes exactly through each
//                                          point's colour, `falloff` is p
//   gaussian  w = weight · e^-(d/r)²     — normalised radial basis; smoother,
//                                          `falloff` is the radius r
//
// Both are *normalised* (weights divided by their sum), so the result is
// always a convex blend of the point colours — it can never leave the gamut
// the artist picked, no matter how the points are arranged.
//
// Nothing in Canvas or SVG can draw this, so it is evaluated per pixel by
// {@link freeformRaster} — the one place the field is defined, shared by the
// canvas renderer and SVG export so they cannot drift. The field is smooth by
// construction, so the raster is deliberately small and relies on bilinear
// upscaling; see `docs/freeform-gradients.md`.
//
// Placement reuses the gradient vocabulary: points live either in `bounds`
// space (0..1 of the shape's fill bounds, so they follow a resize) or `local`
// space (shape-local user units, pinned).
// ===========================================================================

import {
  hexToRgb,
  type InterpolationSpace,
  linearToOklab,
  linearToSrgb,
  linearToSrgb255,
  oklabToLinear,
  rgbToHex,
  srgbToLinear,
} from "./color";
import {
  gradient,
  type GradientPaint,
  type GradientSpace,
  gradientStop,
  sortedStops,
} from "./gradient";
import { type Bounds, makeId, type Vec2 } from "./types";

/** How a point's influence falls off with distance. */
export type FreeformMethod = "shepard" | "gaussian";

/** One colour point of the scattered set. */
export interface FreeformPoint {
  /** Stable identity, so dragging a point past another can't swap them. */
  id: string;
  /** Position in the paint's {@link GradientSpace}. */
  position: Vec2;
  color: string;
  alpha: number;
  /** Relative influence, 1 = neutral. Larger spreads this point's colour. */
  weight: number;
}

export interface FreeformPaint {
  type: "freeform";
  space: GradientSpace;
  /** At least one; a single point paints flat. */
  points: FreeformPoint[];
  method: FreeformMethod;
  /**
   * `shepard`: the distance exponent p (1 = wide and flat, 4 = tight cells).
   * `gaussian`: the radius r, in the paint's own space units.
   */
  falloff: number;
  interpolation: InterpolationSpace;
  /** 0..1 opacity of the whole paint, on top of each point's alpha. */
  alpha: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export const MIN_FALLOFF = 0.001;
/** Highest useful Shepard exponent; past this the cells are hard-edged. */
export const MAX_EXPONENT = 8;

/**
 * Keep `falloff` in the range its method gives it meaning in. The two are
 * different quantities: an exponent is unitless and small, while a gaussian
 * radius is a *length in the paint's own space* — 0.4 of the unit box when the
 * field is bounds-relative, but easily hundreds of user units once it is
 * pinned. Only the exponent has an upper bound.
 */
export const clampFalloff = (method: FreeformMethod, n: number): number =>
  method === "shepard" ? clamp(n, 1, MAX_EXPONENT) : Math.max(n, MIN_FALLOFF);

/** Sensible `falloff` for a method, in bounds space (the unit box). */
export const defaultFalloff = (method: FreeformMethod): number =>
  method === "shepard" ? 2 : 0.4;

export function freeformPoint(
  color: string,
  position: Vec2,
  opts: { alpha?: number; weight?: number } = {}
): FreeformPoint {
  return {
    id: makeId("fpt"),
    position,
    color,
    alpha: clamp01(opts.alpha ?? 1),
    weight: clamp(opts.weight ?? 1, 0.01, 100),
  };
}

export function freeform(
  points: FreeformPoint[],
  opts: Partial<Omit<FreeformPaint, "type" | "points">> = {}
): FreeformPaint {
  const method = opts.method ?? "shepard";
  return {
    type: "freeform",
    space: opts.space ?? "bounds",
    points,
    method,
    falloff: clampFalloff(method, opts.falloff ?? defaultFalloff(method)),
    interpolation: opts.interpolation ?? "oklab",
    alpha: clamp01(opts.alpha ?? 1),
  };
}

/** Whether a paint is a freeform gradient. */
export function isFreeform(paint: { type: string } | null | undefined): paint is FreeformPaint {
  return !!paint && paint.type === "freeform";
}

/** A starting set of four corner-ish points, in bounds space. */
export function defaultFreeformPoints(base = "#4d7cff"): FreeformPoint[] {
  const { r, g, b } = hexToRgb(base);
  const shift = (dr: number, dg: number, db: number) =>
    rgbToHex(clamp(r + dr, 0, 255), clamp(g + dg, 0, 255), clamp(b + db, 0, 255));
  return [
    freeformPoint(shift(60, 20, -40), { x: 0.2, y: 0.25 }),
    freeformPoint(shift(-40, -20, 60), { x: 0.8, y: 0.2 }),
    freeformPoint(shift(-30, 60, 10), { x: 0.25, y: 0.8 }),
    freeformPoint(shift(70, -10, 40), { x: 0.8, y: 0.75 }),
  ];
}

// ---------------------------------------------------------------------------
// Editing helpers — shared by the panel and the on-canvas tool, so both
// produce exactly the same edits.
// ---------------------------------------------------------------------------

export function updateFreeformPoint(
  paint: FreeformPaint,
  id: string,
  patch: Partial<Omit<FreeformPoint, "id">>
): FreeformPaint {
  return {
    ...paint,
    points: paint.points.map((p) =>
      p.id === id
        ? {
            ...p,
            ...patch,
            alpha: clamp01(patch.alpha ?? p.alpha),
            weight: clamp(patch.weight ?? p.weight, 0.01, 100),
          }
        : p
    ),
  };
}

/** A freeform gradient always keeps at least one point. */
export function removeFreeformPoint(paint: FreeformPaint, id: string): FreeformPaint {
  if (paint.points.length <= 1) return paint;
  return { ...paint, points: paint.points.filter((p) => p.id !== id) };
}

/**
 * Add a point at `position` (paint space), taking the colour the field already
 * has there, the way `addStopAt` does on a ramp. The colour *at* the new point
 * is therefore unchanged and it reads as a grab handle — but unlike a stop it
 * does re-weight the blend around itself, because a point's whole job is to
 * pull colour towards where it sits.
 */
export function addFreeformPointAt(
  paint: FreeformPaint,
  position: Vec2
): { paint: FreeformPaint; point: FreeformPoint } {
  const at = sampleFreeformField(paint, position);
  const point = freeformPoint(at.color, position, { alpha: at.alpha });
  return { paint: { ...paint, points: [...paint.points, point] }, point };
}

/** Maps the 0..1 unit square onto `bounds` (the bounds-space convention). */
const toBounds = (b: Bounds, p: Vec2): Vec2 => ({
  x: b.x + p.x * b.width,
  y: b.y + p.y * b.height,
});

/** Local space → the paint's own space. */
export function toFreeformSpace(paint: FreeformPaint, p: Vec2, bounds: Bounds): Vec2 {
  if (paint.space === "local") return p;
  return {
    x: bounds.width === 0 ? 0 : (p.x - bounds.x) / bounds.width,
    y: bounds.height === 0 ? 0 : (p.y - bounds.y) / bounds.height,
  };
}

/** The paint's own space → local space. */
export function fromFreeformSpace(paint: FreeformPaint, p: Vec2, bounds: Bounds): Vec2 {
  return paint.space === "local" ? p : toBounds(bounds, p);
}

/**
 * Switch between bounds-relative and pinned placement without moving the
 * points: every one is converted through the shape's fill bounds. A gaussian
 * radius travels with them, scaled by the mean of the two axes.
 *
 * On a non-square shape the *picture* cannot survive the switch exactly, and
 * no conversion could make it: bounds space measures distance in the
 * normalised box (so the field stretches with the shape) while local space
 * measures true units. The points keep their places; the blend between them
 * un-squashes. Without bounds (a "new shape defaults" field has no shape) the
 * points are kept and only the label changes.
 */
export function withFreeformSpace(
  paint: FreeformPaint,
  space: GradientSpace,
  bounds: Bounds | null
): FreeformPaint {
  if (paint.space === space) return paint;
  if (!bounds || bounds.width === 0 || bounds.height === 0) return { ...paint, space };
  const scale = (bounds.width + bounds.height) / 2;
  const convert = (p: Vec2): Vec2 =>
    space === "local"
      ? toBounds(bounds, p)
      : { x: (p.x - bounds.x) / bounds.width, y: (p.y - bounds.y) / bounds.height };
  const falloff =
    paint.method === "gaussian"
      ? clampFalloff(paint.method, paint.falloff * (space === "local" ? scale : 1 / scale))
      : paint.falloff;
  return {
    ...paint,
    space,
    falloff,
    points: paint.points.map((p) => ({ ...p, position: convert(p.position) })),
  };
}

/**
 * Change the interpolation method, re-defaulting `falloff` — an exponent and a
 * radius are different quantities and carrying the number across is nonsense.
 * A pinned gaussian radius is scaled out of the unit box by `bounds`.
 */
export function withFreeformMethod(
  paint: FreeformPaint,
  method: FreeformMethod,
  bounds: Bounds | null
): FreeformPaint {
  if (paint.method === method) return paint;
  let falloff = defaultFalloff(method);
  if (method === "gaussian" && paint.space === "local") {
    const scale = bounds ? (bounds.width + bounds.height) / 2 : 100;
    falloff = clampFalloff(method, falloff * scale);
  }
  return { ...paint, method, falloff };
}

// ---------------------------------------------------------------------------
// Conversions to and from a ramp — the paint-kind buttons in the colour
// popover and the gradient tool's bar both cross this line, and an artist who
// crosses it by accident should be able to cross back and still recognise
// their colours.
// ---------------------------------------------------------------------------

/**
 * A ramp as a scattered field: one colour point per stop, laid along the
 * gradient's own axis (which is its centre→edge line for a radial or conic —
 * an approximation, but one that keeps every colour where it was brightest).
 */
export function gradientToFreeform(paint: GradientPaint): FreeformPaint {
  const d = { x: paint.end.x - paint.start.x, y: paint.end.y - paint.start.y };
  return freeform(
    sortedStops(paint.stops).map((s) =>
      freeformPoint(
        s.color,
        { x: paint.start.x + d.x * s.offset, y: paint.start.y + d.y * s.offset },
        { alpha: s.alpha }
      )
    ),
    {
      space: paint.space,
      interpolation: paint.interpolation,
      alpha: paint.alpha,
    }
  );
}

/**
 * A scattered field reduced to a ramp: the axis runs between the two points
 * furthest apart and takes their two colours. Deliberately no more than that —
 * projecting every point onto that axis produces stops in an arbitrary order,
 * piled on top of each other, describing a picture the field never showed. A
 * ramp has nowhere to put a two-dimensional arrangement, so this keeps the one
 * thing it can carry honestly (the widest colour transition) and drops the
 * rest. Panels that can remember the ramp the field came from should restore
 * that instead of calling this.
 */
export function freeformToGradient(paint: FreeformPaint): GradientPaint {
  const opts = {
    space: paint.space,
    interpolation: paint.interpolation,
    alpha: paint.alpha,
  };
  const first = paint.points[0];
  if (!first) return gradient([gradientStop("#000000", 0), gradientStop("#ffffff", 1)], opts);
  // The widest pair of points is the transition worth keeping.
  let from = first;
  let to = first;
  let best = -1;
  for (const a of paint.points) {
    for (const b of paint.points) {
      const d = (a.position.x - b.position.x) ** 2 + (a.position.y - b.position.y) ** 2;
      if (d > best) {
        best = d;
        from = a;
        to = b;
      }
    }
  }
  // A single point (or several in one place) has no axis: a flat ramp of it.
  const end =
    best > 1e-12 ? to.position : { x: from.position.x + 1, y: from.position.y };
  return gradient(
    [
      gradientStop(from.color, 0, { alpha: from.alpha }),
      gradientStop(to.color, 1, { alpha: to.alpha }),
    ],
    { ...opts, start: from.position, end }
  );
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/**
 * The point set prepared for evaluation: colours converted once into the
 * interpolation space and premultiplied by alpha, so the per-pixel loop is a
 * weighted sum and nothing else. Premultiplying is what keeps a translucent
 * point from bleeding its hue into its transparent surroundings.
 */
interface PreparedPoint {
  x: number;
  y: number;
  weight: number;
  /** Premultiplied channels in the interpolation space. */
  c0: number;
  c1: number;
  c2: number;
  a: number;
}

/** sRGB → the interpolation space's three channels (0..1-ish). */
function toSpace(color: string, space: InterpolationSpace): [number, number, number] {
  const { r, g, b } = hexToRgb(color);
  if (space === "srgb") return [r / 255, g / 255, b / 255];
  return linearToOklab(srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255));
}

/** The interpolation space's channels back to a `#rrggbb` colour. */
function fromSpace(c: [number, number, number], space: InterpolationSpace): string {
  if (space === "srgb") {
    return rgbToHex(
      Math.round(clamp01(c[0]) * 255),
      Math.round(clamp01(c[1]) * 255),
      Math.round(clamp01(c[2]) * 255)
    );
  }
  const [r, g, b] = oklabToLinear(c[0], c[1], c[2]);
  return rgbToHex(
    Math.round(clamp01(linearToSrgb(r)) * 255),
    Math.round(clamp01(linearToSrgb(g)) * 255),
    Math.round(clamp01(linearToSrgb(b)) * 255)
  );
}

function prepare(paint: FreeformPaint): PreparedPoint[] {
  return paint.points.map((p) => {
    const c = toSpace(p.color, paint.interpolation);
    const a = clamp01(p.alpha);
    return {
      x: p.position.x,
      y: p.position.y,
      weight: Math.max(p.weight, 1e-6),
      c0: c[0] * a,
      c1: c[1] * a,
      c2: c[2] * a,
      a,
    };
  });
}

/**
 * `e^-x` for x >= 0, through a table. Called once per point per pixel by the
 * gaussian kernel, where it is the whole cost; the weights are normalised
 * afterwards, so a table's relative error is invisible. Past `EXP_MAX` the
 * kernel is under 1e-7 and rounds to nothing.
 */
const EXP_MAX = 16;
const EXP_LUT_SIZE = 2048;
let expLut: Float32Array | null = null;
function expNeg(x: number): number {
  if (!expLut) {
    expLut = new Float32Array(EXP_LUT_SIZE + 1);
    for (let i = 0; i <= EXP_LUT_SIZE; i++) {
      expLut[i] = Math.exp((-i / EXP_LUT_SIZE) * EXP_MAX);
    }
  }
  if (x >= EXP_MAX) return 0;
  const t = (x / EXP_MAX) * EXP_LUT_SIZE;
  const i = t | 0;
  const f = t - i;
  return expLut[i]! + (expLut[i + 1]! - expLut[i]!) * f;
}

/**
 * `d2 ^ half`, with the whole-number exponents spelled out. `Math.pow` is
 * called once per point per pixel, so an integer Shepard exponent (every one
 * the UI's slider can land on but the fractions) must not pay for it.
 */
function powHalf(d2: number, half: number): number {
  if (half === 1) return d2; // p = 2, the default
  if (half === 0.5) return Math.sqrt(d2); // p = 1
  if (half === 1.5) return d2 * Math.sqrt(d2); // p = 3
  if (half === 2) return d2 * d2; // p = 4
  return Math.pow(d2, half);
}

/** Weighted, premultiplied channels at one position; null when unresolvable. */
function accumulate(
  pts: PreparedPoint[],
  method: FreeformMethod,
  falloff: number,
  x: number,
  y: number,
  out: [number, number, number, number]
): void {
  let sum = 0;
  out[0] = out[1] = out[2] = out[3] = 0;
  if (method === "shepard") {
    const half = clampFalloff("shepard", falloff) / 2;
    for (const p of pts) {
      const dx = x - p.x;
      const dy = y - p.y;
      const d2 = dx * dx + dy * dy;
      // Exactly on a point: that point's colour, unblended. Bail out rather
      // than divide by zero — the limit of the sum is this point anyway.
      if (d2 < 1e-12) {
        out[0] = p.c0;
        out[1] = p.c1;
        out[2] = p.c2;
        out[3] = p.a;
        return;
      }
      const w = p.weight / powHalf(d2, half);
      sum += w;
      out[0] += w * p.c0;
      out[1] += w * p.c1;
      out[2] += w * p.c2;
      out[3] += w * p.a;
    }
  } else {
    const r = Math.max(falloff, MIN_FALLOFF);
    const k = 1 / (r * r);
    for (const p of pts) {
      const dx = x - p.x;
      const dy = y - p.y;
      const w = p.weight * expNeg((dx * dx + dy * dy) * k);
      sum += w;
      out[0] += w * p.c0;
      out[1] += w * p.c1;
      out[2] += w * p.c2;
      out[3] += w * p.a;
    }
  }
  if (sum > 1e-12) {
    out[0] /= sum;
    out[1] /= sum;
    out[2] /= sum;
    out[3] /= sum;
    return;
  }
  // Every kernel underflowed (a tiny gaussian radius, far from every point):
  // fall back to the nearest point so the field stays defined everywhere.
  let best = pts[0]!;
  let bestD = Infinity;
  for (const p of pts) {
    const d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  out[0] = best.c0;
  out[1] = best.c1;
  out[2] = best.c2;
  out[3] = best.a;
}

/** The field's colour at a position given in the paint's own space. */
export function sampleFreeformField(
  paint: FreeformPaint,
  position: Vec2
): { color: string; alpha: number } {
  const pts = prepare(paint);
  if (pts.length === 0) return { color: "#000000", alpha: 0 };
  const out: [number, number, number, number] = [0, 0, 0, 0];
  accumulate(pts, paint.method, paint.falloff, position.x, position.y, out);
  const a = out[3];
  // Un-premultiply before handing back a hex colour.
  const c: [number, number, number] =
    a > 1e-6 ? [out[0] / a, out[1] / a, out[2] / a] : [out[0], out[1], out[2]];
  return { color: fromSpace(c, paint.interpolation), alpha: clamp01(a) };
}

/** The field's colour at a point in the shape's local space. */
export function sampleFreeform(
  paint: FreeformPaint,
  local: Vec2,
  bounds: Bounds
): { color: string; alpha: number } {
  return sampleFreeformField(paint, toFreeformSpace(paint, local, bounds));
}

/**
 * Rasterise the field over `rect` (local space) into `width`×`height` RGBA
 * pixels, premultiplied-correct and with the paint's own alpha folded in.
 * This is the single definition of what a freeform paint looks like: the
 * canvas renderer wraps it in a `CanvasPattern` and SVG export embeds it as an
 * `<image>`, so the two cannot disagree.
 */
export function freeformRaster(
  paint: FreeformPaint,
  rect: Bounds,
  bounds: Bounds,
  width: number,
  height: number
): Uint8ClampedArray<ArrayBuffer> {
  // Backed by a plain ArrayBuffer so it can go straight into an `ImageData`.
  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const pts = prepare(paint);
  if (pts.length === 0) return data;
  const paintAlpha = clamp01(paint.alpha);
  const srgb = paint.interpolation === "srgb";
  const out: [number, number, number, number] = [0, 0, 0, 0];
  // Pixel centre → local space → paint space, folded into one affine map per
  // axis so the inner loop stays two multiplies.
  const local = paint.space === "local";
  const sx = rect.width / width / (local ? 1 : bounds.width || 1);
  const sy = rect.height / height / (local ? 1 : bounds.height || 1);
  const ox = local
    ? rect.x
    : (rect.x - bounds.x) / (bounds.width || 1);
  const oy = local
    ? rect.y
    : (rect.y - bounds.y) / (bounds.height || 1);
  let i = 0;
  for (let py = 0; py < height; py++) {
    const y = oy + (py + 0.5) * sy;
    for (let px = 0; px < width; px++) {
      const x = ox + (px + 0.5) * sx;
      accumulate(pts, paint.method, paint.falloff, x, y, out);
      const a = clamp01(out[3]) * paintAlpha;
      // Un-premultiply, convert, then re-premultiply against the final alpha —
      // ImageData is *not* premultiplied, so the channels go out straight.
      const inv = out[3] > 1e-6 ? 1 / out[3] : 0;
      let r: number;
      let g: number;
      let b: number;
      if (srgb) {
        r = clamp01(out[0] * inv) * 255;
        g = clamp01(out[1] * inv) * 255;
        b = clamp01(out[2] * inv) * 255;
      } else {
        // The one hot loop in the whole feature. `oklabToLinear` is inlined
        // because returning a tuple here means an allocation per pixel, and
        // the sRGB encode goes through a table because a `Math.pow` per
        // channel per pixel costs more than everything else combined.
        const L = out[0] * inv;
        const A = out[1] * inv;
        const B2 = out[2] * inv;
        const l0 = L + 0.3963377774 * A + 0.2158037573 * B2;
        const m0 = L - 0.1055613458 * A - 0.0638541728 * B2;
        const s0 = L - 0.0894841775 * A - 1.291485548 * B2;
        // Cubed by multiplication: `x ** 3` compiles to a `pow` call.
        const l = l0 * l0 * l0;
        const m = m0 * m0 * m0;
        const s2 = s0 * s0 * s0;
        r = linearToSrgb255(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s2);
        g = linearToSrgb255(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s2);
        b = linearToSrgb255(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s2);
      }
      data[i++] = r;
      data[i++] = g;
      data[i++] = b;
      data[i++] = a * 255;
    }
  }
  return data;
}

/**
 * The mean colour of the point set — the flat stand-in wherever the field
 * itself cannot be drawn (a 20 px swatch, an export with no canvas to
 * rasterise into). A gaussian with an enormous radius weights every point
 * equally, which is exactly the mean.
 */
export function freeformAverage(paint: FreeformPaint): { color: string; alpha: number } {
  return sampleFreeformField(
    { ...paint, method: "gaussian", falloff: 1e6 },
    { x: 0, y: 0 }
  );
}

/**
 * A CSS approximation for swatch previews: one soft radial blob per point over
 * the average colour. Previews are 20 px tall and cannot run the real field,
 * and CSS has no scattered interpolation — this only has to read as "these
 * colours, in roughly that arrangement". A pinned (`local`) paint has no box
 * to place blobs in, so it previews as its average colour alone.
 */
export function freeformToCss(paint: FreeformPaint): string {
  const pts = paint.points;
  if (pts.length === 0) return "transparent";
  const avg = freeformAverage(paint);
  const base = `linear-gradient(${rgbaOf(avg.color, avg.alpha * paint.alpha)}, ${rgbaOf(
    avg.color,
    avg.alpha * paint.alpha
  )})`;
  if (paint.space !== "bounds") return base;
  const blobs = pts.map((p) => {
    const c = rgbaOf(p.color, p.alpha * paint.alpha);
    const transparent = rgbaOf(p.color, 0);
    return `radial-gradient(circle at ${pct(p.position.x)} ${pct(
      p.position.y
    )}, ${c} 0%, ${transparent} 70%)`;
  });
  return [...blobs, base].join(", ");
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const rgbaOf = (color: string, alpha: number) => {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha).toFixed(3)})`;
};
