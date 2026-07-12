// ===========================================================================
// Paint — how a shape's fill or stroke is coloured. Today only solid colours
// with an alpha channel exist, but fill/stroke are modelled as a discriminated
// `Paint` union so gradients and patterns can be added later without touching
// every render/export/serialize/UI site again. A `null` fill/stroke still
// means "no paint".
// ===========================================================================

import type { Bounds } from "./types";

export interface SolidPaint {
  type: "solid";
  /** `#rrggbb` colour (no alpha). */
  color: string;
  /** 0..1 opacity of this paint, independent of the node's opacity. */
  alpha: number;
}

// Future: | LinearGradientPaint | RadialGradientPaint | PatternPaint
export type Paint = SolidPaint;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function solid(color: string, alpha = 1): SolidPaint {
  return { type: "solid", color, alpha: clamp01(alpha) };
}

export function isSolid(paint: Paint): paint is SolidPaint {
  return paint.type === "solid";
}

/** Parse `#rgb`/`#rrggbb` to 0-255 channels (black on malformed input). */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace("#", "").toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** CSS colour string for a paint (used for canvas styles and previews). */
export function paintToCss(paint: Paint): string {
  const { r, g, b } = hexToRgb(paint.color);
  return `rgba(${r}, ${g}, ${b}, ${paint.alpha})`;
}

/**
 * Resolve a paint to a Canvas 2D fill/stroke style. `bounds` (shape-local) is
 * unused for solids but reserved so gradients can build a CanvasGradient.
 */
export function resolvePaint(
  _ctx: CanvasRenderingContext2D,
  paint: Paint,
  _bounds?: Bounds
): string | CanvasGradient {
  return paintToCss(paint);
}

const round = (n: number) => parseFloat(n.toFixed(3)).toString();

/** SVG attributes for a paint applied as `fill` or `stroke`. */
export function paintToSvgAttrs(paint: Paint, kind: "fill" | "stroke"): string[] {
  const attrs = [`${kind}="${paint.color}"`];
  if (paint.alpha < 1) attrs.push(`${kind}-opacity="${round(paint.alpha)}"`);
  return attrs;
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
