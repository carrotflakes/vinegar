import { create } from "zustand";

const STORAGE_KEY = "vinegar.pencil";

/**
 * When a freehand stroke becomes a closed path: never, when it ends back on
 * its start ("auto", the default), or always. "always" is for drawing many
 * filled regions in a row, where every stroke is meant to be a loop and
 * landing back on the start each time is just friction.
 */
export type PencilCloseMode = "never" | "auto" | "always";

/** Persisted options for the Pencil (freehand) tool. */
export interface PencilOptions {
  /**
   * Live position smoothing strength, 0 (off) .. ~0.95 (very smooth). Applied
   * as an exponential moving average while drawing, mirroring the brush's
   * stabilizer; the commit-time simplify runs on top of the smoothed points.
   * The value is the fraction of the error kept per 60 Hz frame, not per input
   * sample, so a faster pointer does not draw a less smoothed line.
   */
  smoothing: number;
  /**
   * Commit-time simplify tolerance in screen pixels (divided by the zoom to get
   * world units): larger drops more anchors for a smoother, less faithful path.
   */
  simplify: number;
  /** How a finished stroke decides whether it is a closed path. */
  close: PencilCloseMode;
}

export const PENCIL_DEFAULTS: PencilOptions = {
  smoothing: 0.4,
  simplify: 2,
  close: "auto",
};
const DEFAULTS = PENCIL_DEFAULTS;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function sanitize(o: Partial<PencilOptions>): PencilOptions {
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const close: PencilCloseMode =
    o.close === "never" || o.close === "auto" || o.close === "always"
      ? o.close
      : DEFAULTS.close;
  return {
    smoothing: clamp(num(o.smoothing, DEFAULTS.smoothing), 0, 0.95),
    simplify: clamp(num(o.simplify, DEFAULTS.simplify), 0, 20),
    close,
  };
}

function load(): PencilOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(o: PencilOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
  } catch {
    /* storage is optional */
  }
}

interface PencilStore extends PencilOptions {
  setPencil: (patch: Partial<PencilOptions>) => void;
}

export const usePencil = create<PencilStore>((set, get) => ({
  ...load(),
  setPencil: (patch) => {
    const { setPencil: _s, ...current } = get();
    void _s;
    const next = sanitize({ ...current, ...patch });
    save(next);
    set(next);
  },
}));
