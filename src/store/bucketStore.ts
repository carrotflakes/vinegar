import { create } from "zustand";

const STORAGE_KEY = "vinegar.bucket";

/** Persisted options for the Bucket Fill tool. */
export interface BucketOptions {
  /**
   * Widest boundary gap (world units) that still counts as closed. 0 fills
   * only watertight regions.
   */
  gapTolerance: number;
  /**
   * Stop the fill at stroke/brush centerlines instead of their painted edge,
   * so adjacent fills meet under the line (no gap if the line changes later).
   */
  strokeCenterline: boolean;
}

const DEFAULTS: BucketOptions = {
  gapTolerance: 4,
  strokeCenterline: false,
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function sanitize(o: Partial<BucketOptions>): BucketOptions {
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    gapTolerance: clamp(num(o.gapTolerance, DEFAULTS.gapTolerance), 0, 100),
    strokeCenterline:
      typeof o.strokeCenterline === "boolean"
        ? o.strokeCenterline
        : DEFAULTS.strokeCenterline,
  };
}

function load(): BucketOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(o: BucketOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
  } catch {
    /* storage is optional */
  }
}

interface BucketStore extends BucketOptions {
  setBucket: (patch: Partial<BucketOptions>) => void;
}

export const useBucket = create<BucketStore>((set, get) => ({
  ...load(),
  setBucket: (patch) => {
    const { setBucket: _s, ...current } = get();
    void _s;
    const next = sanitize({ ...current, ...patch });
    save(next);
    set(next);
  },
}));
