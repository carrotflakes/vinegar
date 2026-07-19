// ===========================================================================
// Paint — how a shape's fill or stroke is coloured. Today only solid colours
// with an alpha channel exist, but fill/stroke are modelled as a discriminated
// `Paint` union so gradients and patterns can be added later without touching
// every render/export/serialize/UI site again. A `null` fill/stroke still
// means "no paint".
// ===========================================================================

import type { Bounds, Vec2 } from "./types";

export interface SolidPaint {
  type: "solid";
  /** `#rrggbb` colour (no alpha). */
  color: string;
  /** 0..1 opacity of this paint, independent of the node's opacity. */
  alpha: number;
}

/** One colour stop of a gradient. `offset` is 0..1 along the gradient. */
export interface GradientStop {
  offset: number;
  color: string;
  alpha: number;
}

/** Linear gradient across the shape's bounding box at `angle` (radians). */
export interface LinearGradientPaint {
  type: "linear";
  stops: GradientStop[];
  /** 0 = left→right; increases clockwise (canvas convention, y-down). */
  angle: number;
}

/** Radial gradient from the centre of the shape's bounding box outward. */
export interface RadialGradientPaint {
  type: "radial";
  stops: GradientStop[];
}

export type GradientPaint = LinearGradientPaint | RadialGradientPaint;

/**
 * How a raster paint maps its image onto the shape:
 * - `tile`: repeat across the shape's local space (the original behaviour).
 * - `fill`: scale uniformly to cover the shape's bounds, cropping overflow.
 * - `fit`: scale uniformly to sit inside the bounds (margins stay transparent).
 * - `stretch`: scale non-uniformly to exactly fill the bounds.
 * Absent on legacy paints (pre-mode); treat a missing value as `tile`.
 */
export type PatternMode = "tile" | "fill" | "fit" | "stretch";

/**
 * Raster fill: a document image asset painted across the shape. `mode` picks
 * the mapping (tile / fill / fit / stretch). For `tile`, `scale`/`rotation`/
 * `offset` place the tiling lattice; for `fill`/`fit`, `scale` is a zoom on top
 * of the cover/contain baseline and `offset` pans the image (rotation is
 * ignored); `stretch` ignores all three. Decoded pixels come from the asset
 * cache at paint time, so a pattern that references a missing/decoding asset
 * simply paints nothing.
 */
export interface PatternPaint {
  type: "pattern";
  /** Id of a `kind: "image"` asset in `doc.assets`. */
  assetId: string;
  /** Image-to-shape mapping; missing means `tile` (legacy). */
  mode?: PatternMode;
  /** tile: ×natural pixel size. fill/fit: zoom ×baseline. stretch: ignored. */
  scale: number;
  /** Rotation of the tiling lattice, radians (canvas convention, y-down).
   *  Applied in `tile` mode only. */
  rotation: number;
  /** tile: lattice origin. fill/fit: pan. stretch: ignored. Shape-local. */
  offset: Vec2;
  /** 0..1 opacity of this paint, independent of the node's opacity. */
  alpha: number;
}

/** A pattern's effective mode, defaulting legacy (mode-less) paints to `tile`. */
export function patternMode(paint: PatternPaint): PatternMode {
  return paint.mode ?? "tile";
}

/**
 * Placement of a single (non-`tile`) pattern image in shape-local space: the
 * drawn top-left and size, given the image's natural size and the shape's fill
 * bounds. Shared by the canvas renderer and SVG export so they agree. Not used
 * for `tile` mode, which lays out an infinite lattice instead.
 */
export function patternPlacement(
  paint: PatternPaint,
  natural: { width: number; height: number },
  bounds: Bounds
): { x: number; y: number; width: number; height: number } {
  const { width: iw, height: ih } = natural;
  const { x: bx, y: by, width: bw, height: bh } = bounds;
  if (patternMode(paint) === "stretch") {
    return { x: bx, y: by, width: bw, height: bh };
  }
  const base =
    patternMode(paint) === "fit"
      ? Math.min(bw / iw, bh / ih)
      : Math.max(bw / iw, bh / ih); // fill
  const s = base * paint.scale;
  const dw = iw * s;
  const dh = ih * s;
  return {
    x: bx + (bw - dw) / 2 + paint.offset.x,
    y: by + (bh - dh) / 2 + paint.offset.y,
    width: dw,
    height: dh,
  };
}

export type Paint = SolidPaint | GradientPaint | PatternPaint;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function solid(color: string, alpha = 1): SolidPaint {
  return { type: "solid", color, alpha: clamp01(alpha) };
}

export function pattern(
  assetId: string,
  opts: Partial<Omit<PatternPaint, "type" | "assetId">> = {}
): PatternPaint {
  return {
    type: "pattern",
    assetId,
    mode: opts.mode ?? "tile",
    scale: opts.scale ?? 1,
    rotation: opts.rotation ?? 0,
    offset: opts.offset ?? { x: 0, y: 0 },
    alpha: clamp01(opts.alpha ?? 1),
  };
}

export function linearGradient(stops: GradientStop[], angle = 0): LinearGradientPaint {
  return { type: "linear", stops, angle };
}

export function radialGradient(stops: GradientStop[]): RadialGradientPaint {
  return { type: "radial", stops };
}

export function isSolid(paint: Paint): paint is SolidPaint {
  return paint.type === "solid";
}

export function isGradient(paint: Paint): paint is GradientPaint {
  return paint.type === "linear" || paint.type === "radial";
}

export function isPattern(paint: Paint): paint is PatternPaint {
  return paint.type === "pattern";
}

/** Stops in ascending offset order (rendering requires monotonic offsets). */
export function sortedStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.offset - b.offset);
}

/** Parse `#rgb`/`#rrggbb` to 0-255 channels (black on malformed input). */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace("#", "").toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** rgba() string for a colour + alpha. */
function rgba(color: string, alpha: number): string {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** CSS value for a paint (canvas solid styles, and popover/swatch previews). */
export function paintToCss(paint: Paint): string {
  if (paint.type === "solid") return rgba(paint.color, paint.alpha);
  // Patterns need the decoded asset to preview; callers that can resolve it
  // (ColorField) render their own swatch. Fall back to a neutral fill here.
  if (paint.type === "pattern") return "#8a9099";
  const stops = sortedStops(paint.stops)
    .map((s) => `${rgba(s.color, s.alpha)} ${round(s.offset * 100)}%`)
    .join(", ");
  if (paint.type === "linear") {
    // Canvas angle 0 points right; CSS 0deg points up. Offset by 90°.
    return `linear-gradient(${round((paint.angle * 180) / Math.PI + 90)}deg, ${stops})`;
  }
  return `radial-gradient(circle, ${stops})`;
}

/** A left→right CSS gradient of the stops, for a fixed preview bar. */
export function stopsToCssBar(stops: GradientStop[]): string {
  const s = sortedStops(stops)
    .map((st) => `${rgba(st.color, st.alpha)} ${round(st.offset * 100)}%`)
    .join(", ");
  return `linear-gradient(to right, ${s})`;
}

/**
 * Resolve a paint to a Canvas 2D fill/stroke style. `bounds` (shape-local) is
 * unused for solids; gradients are laid out across it.
 */
export function resolvePaint(
  ctx: CanvasRenderingContext2D,
  paint: Paint,
  bounds?: Bounds
): string | CanvasGradient {
  if (paint.type === "solid") return rgba(paint.color, paint.alpha);
  // Patterns are resolved by the canvas renderer (it owns the asset cache);
  // this pure helper only knows solids and gradients.
  if (paint.type === "pattern") return "transparent";
  const b = bounds ?? { x: 0, y: 0, width: 0, height: 0 };
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  let grad: CanvasGradient;
  if (paint.type === "linear") {
    const dx = Math.cos(paint.angle);
    const dy = Math.sin(paint.angle);
    // Span the bounding box along the gradient direction.
    const half = (Math.abs(b.width * dx) + Math.abs(b.height * dy)) / 2;
    grad = ctx.createLinearGradient(
      cx - dx * half, cy - dy * half,
      cx + dx * half, cy + dy * half
    );
  } else {
    const r = Math.hypot(b.width, b.height) / 2;
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  }
  for (const s of sortedStops(paint.stops)) {
    grad.addColorStop(clamp01(s.offset), rgba(s.color, s.alpha));
  }
  return grad;
}

const round = (n: number) => parseFloat(n.toFixed(3)).toString();

/** SVG attributes for a solid paint applied as `fill` or `stroke`. */
export function paintToSvgAttrs(paint: SolidPaint, kind: "fill" | "stroke"): string[] {
  const attrs = [`${kind}="${paint.color}"`];
  if (paint.alpha < 1) attrs.push(`${kind}-opacity="${round(paint.alpha)}"`);
  return attrs;
}

/** SVG `<linearGradient>`/`<radialGradient>` matching the Canvas resolver. */
export function gradientToSvg(
  paint: GradientPaint,
  id: string,
  bounds?: Bounds
): string {
  const stops = sortedStops(paint.stops)
    .map(
      (s) =>
        `<stop offset="${round(s.offset)}" stop-color="${s.color}"` +
        (s.alpha < 1 ? ` stop-opacity="${round(s.alpha)}"` : "") +
        `/>`
    )
    .join("");
  if (bounds) {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    if (paint.type === "linear") {
      const dx = Math.cos(paint.angle);
      const dy = Math.sin(paint.angle);
      const half =
        (Math.abs(bounds.width * dx) + Math.abs(bounds.height * dy)) / 2;
      return (
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
        `x1="${round(cx - dx * half)}" y1="${round(cy - dy * half)}" ` +
        `x2="${round(cx + dx * half)}" y2="${round(cy + dy * half)}">` +
        `${stops}</linearGradient>`
      );
    }
    const radius = Math.hypot(bounds.width, bounds.height) / 2;
    return (
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `cx="${round(cx)}" cy="${round(cy)}" r="${round(radius)}">` +
      `${stops}</radialGradient>`
    );
  }
  if (paint.type === "linear") {
    const dx = Math.cos(paint.angle);
    const dy = Math.sin(paint.angle);
    return (
      `<linearGradient id="${id}" x1="${round(0.5 - dx * 0.5)}" y1="${round(
        0.5 - dy * 0.5
      )}" x2="${round(0.5 + dx * 0.5)}" y2="${round(0.5 + dy * 0.5)}">` +
      `${stops}</linearGradient>`
    );
  }
  return `<radialGradient id="${id}">${stops}</radialGradient>`;
}

/**
 * Coerce a legacy or loosely-typed value into a Paint (or null). Accepts the
 * pre-v10 `string | null` form and validates a structured solid paint.
 */
export function paintFromLegacy(value: unknown): Paint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return solid(value, 1);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.type === "solid" && typeof v.color === "string") {
      return solid(v.color, typeof v.alpha === "number" ? v.alpha : 1);
    }
  }
  return null;
}
