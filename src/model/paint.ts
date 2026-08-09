// ===========================================================================
// Paint — how a shape's fill or stroke is coloured. Fill/stroke are a
// discriminated `Paint` union of solid colours, gradients, raster patterns and
// references to document swatches. A `null` fill/stroke means "no paint".
//
// Gradients carry enough geometry to be placed by hand, and all of that lives
// in `gradient.ts`; this module only folds the type into the union.
// ===========================================================================

import { rgba } from "./color";
import { type FreeformPaint, freeformToCss } from "./freeform";
import { type GradientPaint, gradientToCss } from "./gradient";
import type { Bounds, Swatch, Vec2 } from "./types";

export type {
  FreeformMethod,
  FreeformPaint,
  FreeformPoint,
} from "./freeform";
export type {
  GradientKind,
  GradientPaint,
  GradientSpace,
  GradientSpread,
  GradientStop,
} from "./gradient";
export { hexToRgb } from "./color";

export interface SolidPaint {
  type: "solid";
  /** `#rrggbb` colour (no alpha). */
  color: string;
  /** 0..1 opacity of this paint, independent of the node's opacity. */
  alpha: number;
}

/**
 * How a raster paint maps its image onto the shape:
 * - `tile`: repeat across the shape's local space (the original behaviour).
 * - `fill`: scale uniformly to cover the shape's bounds, cropping overflow.
 * - `fit`: scale uniformly to sit inside the bounds (margins stay transparent).
 * - `stretch`: scale non-uniformly to exactly fill the bounds.
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
  /** Image-to-shape mapping. */
  mode: PatternMode;
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
  if (paint.mode === "stretch") {
    return { x: bx, y: by, width: bw, height: bh };
  }
  const base =
    paint.mode === "fit"
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

/**
 * A reference to a document-level global colour ({@link Swatch}). The concrete
 * paint lives once in `doc.swatches`; every referencing fill/stroke resolves it
 * at paint time (see {@link resolvePaintRef}), so editing the swatch re-tints
 * every use live. Only appears in documents authored after global colours ship.
 */
export interface SwatchRefPaint {
  type: "swatch";
  /** Id of a Swatch in doc.swatches. */
  swatchId: string;
  /** Per-use tint 0..1, multiplied onto the swatch's own alpha (1 = as stored). */
  alpha: number;
}

export type Paint =
  | SolidPaint
  | GradientPaint
  | FreeformPaint
  | PatternPaint
  | SwatchRefPaint;

/** The two paint slots every shape carries. */
export type PaintTarget = "fill" | "stroke";

/** A concrete paint — anything that is not an unresolved swatch reference. */
export type ConcretePaint = Exclude<Paint, SwatchRefPaint>;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function swatchRef(swatchId: string, alpha = 1): SwatchRefPaint {
  return { type: "swatch", swatchId, alpha: clamp01(alpha) };
}

/** Whether a paint is an (unresolved) reference to a document swatch. */
export function isSwatchRef(paint: Paint | null | undefined): paint is SwatchRefPaint {
  return !!paint && paint.type === "swatch";
}

/**
 * Resolve a possibly-referential paint to a concrete one. Returns null for a
 * dangling reference so callers can fall back (render: skip; export: omit).
 * A non-referential paint is returned unchanged.
 */
export function resolvePaintRef(
  paint: Paint | null,
  swatches: Record<string, Swatch>
): ConcretePaint | null {
  if (paint == null) return null;
  if (paint.type !== "swatch") return paint;
  const s = swatches[paint.swatchId];
  if (!s) return null; // dangling — treat as no paint
  const base = s.paint;
  if (base.type === "solid") {
    return { ...base, alpha: clamp01(base.alpha * paint.alpha) };
  }
  return base;
}

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

/** Whether a paint is a freeform gradient (see `freeform.ts`). */
export function isFreeformPaint(paint: Paint): paint is FreeformPaint {
  return paint.type === "freeform";
}

/** Whether a paint is a gradient (see `gradient.ts` for everything about it). */
export function isGradient(paint: Paint): paint is GradientPaint {
  return paint.type === "gradient";
}

/** CSS value for a paint (canvas solid styles, and popover/swatch previews). */
export function paintToCss(paint: Paint): string {
  if (paint.type === "solid") return rgba(paint.color, paint.alpha);
  // Patterns need the decoded asset to preview; callers that can resolve it
  // (ColorField) render their own swatch. Fall back to a neutral fill here.
  if (paint.type === "pattern") return "#8a9099";
  // Swatch references are resolved by callers that can see the document; this
  // pure helper never receives one. Fall back to a neutral fill defensively.
  if (paint.type === "swatch") return "#8a9099";
  // Approximate — CSS has no scattered interpolation; see `freeformToCss`.
  if (paint.type === "freeform") return freeformToCss(paint);
  return gradientToCss(paint);
}

const round = (n: number) => parseFloat(n.toFixed(3)).toString();

/** SVG attributes for a solid paint applied as `fill` or `stroke`. */
export function paintToSvgAttrs(paint: SolidPaint, kind: PaintTarget): string[] {
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
