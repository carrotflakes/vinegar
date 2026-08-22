// Non-destructive appearance effects. Effects live on any BaseNode as an
// ordered stack, applied after the node's content is rendered and before its
// opacity/blend composite. Lengths are in the node's local space, so they scale
// with the node's transform chain (like stroke width).
//
// Two kinds share the stack:
//   * pixel effects (blur, drop shadow, colour adjust, tint) filter whatever
//     the stack has produced so far;
//   * geometry effects (fill, stroke) paint the node's *own outline* on top of
//     it, so they are a no-op on nodes that have no outline (see
//     `paintsGeometryEffects`).
// Stack order is paint order either way: a later entry sees the earlier ones.

import { solid } from "./paint";
import { hasVectorGeometry } from "./path/shapeGeometry";
import { STROKE_MITER_LIMIT } from "./stroke";
import { makeId } from "./types";
import type {
  BlurEffect,
  ColorAdjustEffect,
  TintEffect,
  Document,
  DropShadowEffect,
  Effect,
  GeometryEffect,
  Shape,
  StrokeEffect,
} from "./types";

/**
 * Canvas `shadowBlur` produces a Gaussian roughly twice as wide as the same
 * value fed to `feGaussianBlur`'s `stdDeviation`. Halving keeps the SVG export
 * visually matched to the canvas preview. CSS `blur(r)` already equals a
 * `stdDeviation` of `r`, so the plain blur effect needs no conversion.
 */
export const SHADOW_BLUR_TO_STDDEV = 0.5;

/** A Gaussian's visible reach is ~3 standard deviations. */
const BLUR_REACH = 3;

type EffectDefaults<T extends Effect> = Omit<T, "id" | "enabled">;

const DEFAULT_DROP_SHADOW: EffectDefaults<DropShadowEffect> = {
  type: "drop-shadow",
  color: "#000000",
  alpha: 0.4,
  blur: 6,
  offsetX: 4,
  offsetY: 4,
};

const DEFAULT_BLUR: EffectDefaults<BlurEffect> = { type: "blur", radius: 4 };

const DEFAULT_COLOR_ADJUST: EffectDefaults<ColorAdjustEffect> = {
  type: "color-adjust",
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
};

const DEFAULT_TINT: EffectDefaults<TintEffect> = {
  type: "tint",
  color: "#ff3366",
  alpha: 1,
};

/** A new effect of `type`, with a fresh id. */
export function defaultEffect(type: Effect["type"]): Effect {
  const id = makeId("effect");
  const base = { id, enabled: true };
  switch (type) {
    case "blur":
      return { ...base, ...DEFAULT_BLUR };
    case "color-adjust":
      return { ...base, ...DEFAULT_COLOR_ADJUST };
    case "tint":
      return { ...base, ...DEFAULT_TINT };
    case "fill":
      // A fresh paint per effect: paints are replaced wholesale, never mutated,
      // but sharing one object across effects would still alias undo patches.
      return { ...base, type: "fill", paint: solid("#ff3366", 1), blendMode: "normal" };
    case "stroke":
      return {
        ...base,
        type: "stroke",
        paint: solid("#000000", 1),
        width: 2,
        alignment: "center",
        cap: "round",
        join: "round",
        blendMode: "normal",
      };
    default:
      return { ...base, ...DEFAULT_DROP_SHADOW };
  }
}

/** Whether an effect paints the node's geometry rather than filtering pixels. */
export function isGeometryEffect(effect: Effect): effect is GeometryEffect {
  return effect.type === "fill" || effect.type === "stroke";
}

/**
 * Whether a stack has to run on an isolated offscreen layer, or can be painted
 * straight onto the target in order.
 *
 * A pixel effect filters what is below it, so it needs those pixels alone on a
 * layer. A geometry effect only *adds* paint — unless it blends, which must mix
 * with the node's own artwork and stop there (SVG spells that `isolation:
 * isolate`; on canvas the layer *is* the isolation). Everything else paints
 * directly, which is what keeps an ordinary stroke effect off the layer pool.
 *
 * The node's own opacity and blend mode are the caller's business: they also
 * force isolation, because they composite the finished stack as one group.
 */
export function needsEffectIsolation(effects: Effect[]): boolean {
  return effects.some(
    (effect) => !isGeometryEffect(effect) || effect.blendMode !== "normal"
  );
}

/**
 * The entries a reader must apply: a bypassed one (`enabled: false`) drops out.
 * Rendering, bounds and SVG export have to agree on what the stack produces, so
 * every reader of a node's raw `effects` goes through this — directly, or via
 * {@link pixelEffects} / {@link effectsMargin}, which fold it in. Paint walkers
 * (`nodePaints`) deliberately do not: a bypassed fill still references its
 * asset, and pruning it on save would lose it.
 */
export function activeEffects(effects: Effect[]): Effect[] {
  return effects.some((effect) => !effect.enabled)
    ? effects.filter((effect) => effect.enabled)
    : effects;
}

/**
 * The entries that actually filter pixels. Readers that can only apply those —
 * a node with no outline, or an SVG `<filter>` — take this rather than the whole
 * stack, so a geometry-only stack stays a no-op instead of becoming an empty
 * filter (which SVG renders as transparent black). Bypassed entries are already
 * gone from the result.
 */
export function pixelEffects(effects: Effect[]): Effect[] {
  const active = activeEffects(effects);
  return active.some(isGeometryEffect)
    ? active.filter((effect) => !isGeometryEffect(effect))
    : active;
}

/**
 * Whether geometry effects (fill / stroke) do anything on this shape: they
 * paint the shape's own outline, so they are inert exactly where there is none
 * (an image, text whose font cannot be outlined). Non-shape nodes never have an
 * outline either, so their fill/stroke entries stay inert too.
 */
export function paintsGeometryEffects(shape: Shape, doc?: Document): boolean {
  return hasVectorGeometry(shape, doc);
}

/**
 * Local-space reach of a stroke effect past the geometry, mirroring
 * `strokeOutset` for a shape's own stroke (miter joins get the same
 * conservative multiplier so exports do not crop sharp corners).
 */
export function strokeEffectOutset(effect: StrokeEffect): number {
  const outset =
    effect.alignment === "inside"
      ? 0
      : effect.alignment === "outside"
        ? effect.width
        : effect.width / 2;
  return effect.join === "miter" ? outset * STROKE_MITER_LIMIT : outset;
}

/** Whether a stack actually paints anything (i.e. is non-empty). */
export function hasEffects(effects: Effect[]): boolean {
  return effects.length > 0;
}

/**
 * How far (in the node's local units) a stack of effects extends the visual
 * result beyond the node's geometry. A safe symmetric over-estimate: effects
 * chain, so their reaches accumulate. Used to keep exports from clipping.
 */
export function effectsMargin(effects: Effect[]): number {
  let margin = 0;
  for (const effect of activeEffects(effects)) {
    if (effect.type === "blur") {
      margin += effect.radius * BLUR_REACH;
    } else if (effect.type === "drop-shadow") {
      margin += Math.hypot(effect.offsetX, effect.offsetY) + effect.blur * BLUR_REACH;
    } else if (effect.type === "stroke") {
      margin += strokeEffectOutset(effect);
    }
    // color-adjust / tint / fill are unitless or bounded by the
    // geometry: they never extend the bounds.
  }
  return margin;
}
