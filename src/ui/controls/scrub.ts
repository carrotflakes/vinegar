// ===========================================================================
// Pointer-travel -> value math behind ScrubbableNumber, kept separate from the
// component so it can be unit tested.
// ===========================================================================

/**
 * How a drag maps onto values. `linear` adds a fixed step per notch — right for
 * lengths and angles. `log` multiplies instead, so a fixed drag distance always
 * changes the value by the same *ratio*; that is what a zoom percentage wants,
 * where the interesting range spans 5% to 6400% and +1% means something very
 * different at each end.
 */
export type ScrubScale = "linear" | "log";

/** Shift scrubs coarsely, Alt finely. */
export type ScrubModifier = "coarse" | "none" | "fine";

/** Travel per step in linear mode — small enough to stay controllable. */
const PX_PER_STEP = 4;
/** Travel per doubling in log mode. */
const PX_PER_DOUBLING = 140;

const STEP_MULTIPLIER: Record<ScrubModifier, number> = {
  coarse: 10,
  none: 1,
  fine: 0.1,
};

// Gentler than the linear multipliers: a ×10 exponent would double the value
// every 14 pixels, which is impossible to land on a value with.
const RATIO_MULTIPLIER: Record<ScrubModifier, number> = {
  coarse: 4,
  none: 1,
  fine: 0.25,
};

/**
 * Round to a multiple of `quantum` and drop the floating-point noise that the
 * division reintroduces (0.30000000000000004), so only clean values are
 * committed.
 */
export function snapTo(raw: number, quantum: number): number {
  const snapped = Math.round(raw / quantum) * quantum;
  const decimals = (String(quantum).split(".")[1] ?? "").length;
  return Number(snapped.toFixed(decimals));
}

export interface ScrubInput {
  scale: ScrubScale;
  /** Value when the drag began; the result is always derived from it, never
   * from the previous frame, so a drag accumulates no error. */
  startValue: number;
  /** Horizontal travel since the drag began, in CSS pixels. */
  dx: number;
  step: number;
  modifier: ScrubModifier;
}

/** The value a scrub of `dx` pixels lands on. Clamping to min/max is the
 * caller's job. */
export function scrubbedValue({
  scale,
  startValue,
  dx,
  step,
  modifier,
}: ScrubInput): number {
  // Nothing to multiply from at (or below) zero, so such a field scrubs
  // linearly whatever it asked for.
  if (scale === "log" && startValue > 0) {
    const perDoubling = PX_PER_DOUBLING / RATIO_MULTIPLIER[modifier];
    return snapTo(startValue * Math.pow(2, dx / perDoubling), step);
  }
  const quantum = step * STEP_MULTIPLIER[modifier];
  return snapTo(startValue + Math.round(dx / PX_PER_STEP) * quantum, quantum);
}

/** Whether the pointer has moved far enough to be a scrub rather than a click. */
export function isScrub(dx: number): boolean {
  return Math.abs(dx) >= 3;
}
