/**
 * The single gate for render profiling. Every `renderStress` /
 * `renderBenchmark` / `renderCaches` / `renderCulling` switch is parsed here
 * once, so no other module needs its own build-mode branch.
 *
 * Enabled in `vite dev`, and in a build started with `VITE_RENDER_DEBUG=1` —
 * absolute frame times are only meaningful on a production build, so the A/B
 * switches have to survive minification when we deliberately ask for them.
 * A normal `pnpm build` folds both flags to `false`, making every field below a
 * constant and letting the bundler drop this directory entirely.
 *
 * The switches are documented in `docs/render-performance.md`.
 */

const enabled =
  import.meta.env.DEV || import.meta.env.VITE_RENDER_DEBUG === "1";

export type RenderStressNodeCount = 1000 | 10000;

export interface RenderBenchmarkRequest {
  /** Measured frames, after the warm-up. */
  frames: number;
  warmupFrames: number;
}

const params =
  enabled && typeof location !== "undefined"
    ? new URLSearchParams(location.search)
    : null;

function benchmarkRequest(): RenderBenchmarkRequest | null {
  const requested = Number(params?.get("renderBenchmark"));
  if (!Number.isFinite(requested) || requested <= 0) return null;
  const requestedWarmup = Number(params?.get("renderWarmup") ?? 30);
  return {
    frames: Math.min(2_000, Math.max(1, Math.floor(requested))),
    warmupFrames: Number.isFinite(requestedWarmup)
      ? Math.min(500, Math.max(0, Math.floor(requestedWarmup)))
      : 30,
  };
}

function stressNodeCount(): RenderStressNodeCount | null {
  const requested = params?.get("renderStress");
  return requested === "1000" || requested === "10000"
    ? (Number(requested) as RenderStressNodeCount)
    : null;
}

/** Disable the reference-keyed render caches for an A/B run. */
export const renderCachesDisabled = params?.get("renderCaches") === "off";

/** Disable viewport culling for an A/B run. */
export const renderCullingDisabled = params?.get("renderCulling") === "off";

/** Collect per-frame samples (User Timing + `__vinegarRenderPerformance`). */
export const renderProfilingEnabled =
  !!params?.has("renderPerformance") || !!params?.has("renderBenchmark");

/** Stress document to load at startup instead of the normal document. */
export const renderStressNodeCount = stressNodeCount();

/** Deterministic redraw benchmark to run once the canvas is mounted. */
export const renderBenchmarkRequest = benchmarkRequest();
