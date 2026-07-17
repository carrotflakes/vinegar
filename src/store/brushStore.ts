import { create } from "zustand";

const STORAGE_KEY = "vinegar.brush";

/** Persisted options for the Brush tool. Independent of the document style. */
export interface BrushOptions {
  /** Base stroke width in world units at full pressure (`w = 1`). */
  size: number;
  /**
   * Pressure response exponent. `1` is linear; `< 1` makes light strokes
   * thicker (softer), `> 1` makes them thinner (harder to build up width).
   */
  pressureGamma: number;
  /** Width at zero pressure, as a fraction of `size` (0..1). */
  minWidth: number;
  /** Position smoothing strength, 0 (off) .. ~0.95 (very smooth). */
  stabilizer: number;
  /** Taper each end to a point over this arc length in world units; 0 = off. */
  taper: number;
}

const DEFAULTS: BrushOptions = {
  size: 8,
  pressureGamma: 1,
  minWidth: 0.15,
  stabilizer: 0.4,
  taper: 0,
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function sanitize(o: Partial<BrushOptions>): BrushOptions {
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    size: clamp(num(o.size, DEFAULTS.size), 0.5, 500),
    pressureGamma: clamp(num(o.pressureGamma, DEFAULTS.pressureGamma), 0.25, 4),
    minWidth: clamp(num(o.minWidth, DEFAULTS.minWidth), 0, 1),
    stabilizer: clamp(num(o.stabilizer, DEFAULTS.stabilizer), 0, 0.95),
    taper: clamp(num(o.taper, DEFAULTS.taper), 0, 500),
  };
}

function load(): BrushOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(o: BrushOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
  } catch {
    /* storage is optional */
  }
}

interface BrushStore extends BrushOptions {
  setBrush: (patch: Partial<BrushOptions>) => void;
}

export const useBrush = create<BrushStore>((set, get) => ({
  ...load(),
  setBrush: (patch) => {
    const { setBrush: _s, ...current } = get();
    void _s;
    const next = sanitize({ ...current, ...patch });
    save(next);
    set(next);
  },
}));

/** Map a raw 0..1 pressure to a width multiplier via the current curve. */
export function pressureToWidth(
  pressure: number,
  opts: Pick<BrushOptions, "pressureGamma" | "minWidth">
): number {
  const p = clamp(pressure, 0, 1);
  return opts.minWidth + (1 - opts.minWidth) * Math.pow(p, opts.pressureGamma);
}
