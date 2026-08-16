// ===========================================================================
// The digit buffer behind NumberPad, kept separate from the component so it can
// be unit tested — the same split as `scrub.ts`.
// ===========================================================================

import { snapTo } from "./scrub";

export type NumberPadKey =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "."
  | "sign"
  | "backspace"
  | "clear";

export interface NumberPadState {
  /** What the display shows, as typed — not necessarily a finite number. */
  text: string;
  /**
   * True while `text` is still the value the pad opened on. The next digit
   * replaces it rather than appending, the way a calculator starts a new entry
   * over its previous result; editing keys (backspace, sign) keep the digits
   * and clear the flag.
   */
  pristine: boolean;
}

export interface NumberRange {
  min?: number | undefined;
  max?: number | undefined;
}

const DIGITS = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/** Whether a raw keyboard key is one the pad handles. */
export function numberPadKeyFor(key: string): NumberPadKey | null {
  if (DIGITS.has(key)) return key as NumberPadKey;
  if (key === "." || key === ",") return ".";
  if (key === "-") return "sign";
  if (key === "Backspace") return "backspace";
  if (key === "Delete") return "clear";
  return null;
}

/** The buffer a pad opens with, showing the field's current value. */
export function numberPadState(value: number): NumberPadState {
  return { text: Number.isFinite(value) ? String(value) : "", pristine: true };
}

export function applyKey(
  state: NumberPadState,
  key: NumberPadKey
): NumberPadState {
  const text = state.pristine && (key === "." || DIGITS.has(key)) ? "" : state.text;

  if (DIGITS.has(key)) {
    // A leading zero is a placeholder, not a digit: typing 5 into "0" gives 5,
    // and into "-0" gives -5.
    const base = text === "0" ? "" : text === "-0" ? "-" : text;
    return { text: base + key, pristine: false };
  }
  if (key === ".") {
    if (text.includes(".")) return { ...state, pristine: false };
    return { text: (text === "" || text === "-" ? text + "0" : text) + ".", pristine: false };
  }
  if (key === "sign") {
    return {
      text: text.startsWith("-") ? text.slice(1) : "-" + text,
      pristine: false,
    };
  }
  if (key === "backspace") {
    // Backspacing the whole incoming value is how you start over; "-" alone is
    // not worth keeping either.
    const next = text.slice(0, -1);
    return { text: next === "-" ? "" : next, pristine: false };
  }
  return { text: "", pristine: false };
}

/** The number the buffer stands for, or null while it is still incomplete
 * ("", "-", or anything that does not parse). */
export function numberPadValue(state: NumberPadState): number | null {
  const text = state.text.trim();
  if (text === "" || text === "-" || text === "." || text === "-.") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function clampToRange(value: number, { min, max }: NumberRange): number {
  if (min != null && value < min) return min;
  if (max != null && value > max) return max;
  return value;
}

/** The value the pad commits, or null when there is nothing to commit. */
export function numberPadCommit(
  state: NumberPadState,
  range: NumberRange
): number | null {
  const value = numberPadValue(state);
  return value === null ? null : clampToRange(value, range);
}

/** The −/+ keys: step off the current value (treating an empty buffer as the
 * bottom of the range, or zero) and show the result as a fresh entry. */
export function nudge(
  state: NumberPadState,
  delta: number,
  range: NumberRange
): NumberPadState {
  const from = numberPadValue(state) ?? range.min ?? 0;
  const next = clampToRange(snapTo(from + delta, Math.abs(delta)), range);
  return { text: String(next), pristine: false };
}
