import { useEffect } from "react";
import type { RenderPerformanceSample } from "@/canvas/render";
import { renderBenchmarkRequest } from "./renderFlags";

/**
 * Deterministic development-only redraw loop for the stress-document query
 * mode (`?renderBenchmark=…`). Results stay in-page as
 * `globalThis.__vinegarRenderBenchmark` so headless browsers and DevTools can
 * read them without console parsing. A no-op unless the switch is present.
 */

interface RenderBenchmarkResult {
  status: "running" | "complete" | "error";
  frames: number;
  warmupFrames: number;
  error?: string;
  samples?: RenderPerformanceSample[];
  summary?: {
    meanMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    meanAcquireLayerCalls: number;
    meanPaintedNodes: number;
    meanCulledNodes: number;
  };
}

type RenderBenchmarkGlobal = typeof globalThis & {
  __vinegarRenderPerformance?: RenderPerformanceSample;
  __vinegarRenderBenchmark?: RenderBenchmarkResult;
};

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export function useRenderBenchmark(draw: () => void): void {
  useEffect(() => {
    const request = renderBenchmarkRequest;
    if (!request) return;
    const { frames, warmupFrames } = request;
    const benchmarkGlobal = globalThis as RenderBenchmarkGlobal;
    benchmarkGlobal.__vinegarRenderBenchmark = {
      status: "running",
      frames,
      warmupFrames,
    };

    let cancelled = false;
    let raf = 0;
    let current = 0;
    const samples: RenderPerformanceSample[] = [];
    const step = () => {
      raf = requestAnimationFrame(() => {
        if (cancelled) return;
        draw();
        const sample = benchmarkGlobal.__vinegarRenderPerformance;
        if (current >= warmupFrames && sample) samples.push({ ...sample });
        current += 1;
        if (current < warmupFrames + frames) {
          step();
          return;
        }
        if (!samples.length) {
          benchmarkGlobal.__vinegarRenderBenchmark = {
            status: "error",
            frames,
            warmupFrames,
            error: "No render performance samples were collected.",
          };
          return;
        }
        const times = samples.map((sample) => sample.paintNodeMs);
        const sorted = [...times].sort((a, b) => a - b);
        benchmarkGlobal.__vinegarRenderBenchmark = {
          status: "complete",
          frames,
          warmupFrames,
          samples,
          summary: {
            meanMs: mean(times),
            p50Ms: percentile(sorted, 0.5),
            p95Ms: percentile(sorted, 0.95),
            maxMs: sorted[sorted.length - 1],
            meanAcquireLayerCalls: mean(
              samples.map((sample) => sample.acquireLayerCalls)
            ),
            meanPaintedNodes: mean(samples.map((sample) => sample.paintedNodes)),
            meanCulledNodes: mean(samples.map((sample) => sample.culledNodes)),
          },
        };
      });
    };
    step();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [draw]);
}
