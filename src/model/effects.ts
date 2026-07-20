// Non-destructive appearance effects (drop shadow / blur). Effects live on any
// BaseNode as an ordered stack, applied after the node's content is rendered
// and before its opacity/blend composite. Lengths are in the node's local
// space, so they scale with the node's transform chain (like stroke width).

import type { Effect } from "./types";

/**
 * Canvas `shadowBlur` produces a Gaussian roughly twice as wide as the same
 * value fed to `feGaussianBlur`'s `stdDeviation`. Halving keeps the SVG export
 * visually matched to the canvas preview. CSS `blur(r)` already equals a
 * `stdDeviation` of `r`, so the plain blur effect needs no conversion.
 */
export const SHADOW_BLUR_TO_STDDEV = 0.5;

/** A Gaussian's visible reach is ~3 standard deviations. */
const BLUR_REACH = 3;

const DEFAULT_DROP_SHADOW: Effect = {
  type: "drop-shadow",
  color: "#000000",
  alpha: 0.4,
  blur: 6,
  offsetX: 4,
  offsetY: 4,
};

const DEFAULT_BLUR: Effect = { type: "blur", radius: 4 };

export function defaultEffect(type: Effect["type"]): Effect {
  return type === "blur" ? { ...DEFAULT_BLUR } : { ...DEFAULT_DROP_SHADOW };
}

export function hasEffects(effects: Effect[] | undefined): effects is Effect[] {
  return !!effects && effects.length > 0;
}

/**
 * How far (in the node's local units) a stack of effects extends the visual
 * result beyond the node's geometry. A safe symmetric over-estimate: effects
 * chain, so their reaches accumulate. Used to keep exports from clipping.
 */
export function effectsMargin(effects: Effect[] | undefined): number {
  if (!hasEffects(effects)) return 0;
  let margin = 0;
  for (const effect of effects) {
    if (effect.type === "blur") {
      margin += effect.radius * BLUR_REACH;
    } else {
      margin += Math.hypot(effect.offsetX, effect.offsetY) + effect.blur * BLUR_REACH;
    }
  }
  return margin;
}
