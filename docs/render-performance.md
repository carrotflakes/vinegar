# Canvas render performance — plan

Status: viewport culling and immutable-reference caches are implemented.
Tight layers and interaction snapshots remain proposals.

## Current architecture (as of this writing)

- Single canvas; every store change schedules one rAF-coalesced full redraw
  (`scheduleDraw` in `src/canvas/CanvasView.tsx`).
- `renderScene` (`src/canvas/render.ts`) repaints background, grid, every
  visible node (frames included, as ordinary container nodes), preview and
  overlay chrome from scratch each frame.
- Compositing still borrows full-canvas offscreen layers (opacity groups,
  effects, masks, outside strokes) from a pool.
- Geometry caches: `cachedBrushEnvelope`, plus the reference-keyed Path2D,
  culling-bounds, text-layout and pattern caches described below.
- Viewport culling skips off-screen subtrees, except inside symbol definitions
  (an instance is culled as a whole, its contents are not).
- No static/dynamic layer split; no dirty-rect tracking.

## Ground rule: measure first

Identify whether the bottleneck is **JS-side** (path building, text layout)
or **raster-side** (fill/stroke pixel cost, layer compositing fill rate)
before optimizing — the fixes are completely different.

- Build a stress document (thousands of shapes, effect-heavy groups, many
  outside strokes) and profile with the Chrome DevTools Performance panel.
- Two cheap counters go a long way: total `paintNode` time per frame, and the
  number of `acquireLayer` calls per frame.
- In development, append `?renderPerformance` to the editor URL. Frames appear
  as `Vinegar paintNode` User Timing entries, and the latest sample (including
  painted/culled node and layer counts) is available as
  `globalThis.__vinegarRenderPerformance` in DevTools.
- On dpr=2 large screens the app is likely fill-rate bound; JS savings won't
  help there.

### Reproducible stress documents

`createRenderStressDocument` builds deterministic 1,000- and 10,000-leaf
documents. Both mix Bézier paths, text, outside strokes, shape/group effects
and opacity groups over a world much larger than the viewport.

Query parameters load and exercise them without changing the normal demo or
saved documents:

- `?renderStress=1000` or `?renderStress=10000` loads the requested scene.
- `&renderBenchmark=60&renderWarmup=20` repeatedly redraws after the given
  warm-up and stores raw samples plus mean/p50/p95 in
  `globalThis.__vinegarRenderBenchmark`.
- `&renderCaches=off` and `&renderCulling=off` independently disable the two
  optimization families for A/B runs.

All of these are parsed once in [`src/debug/renderFlags.ts`](../src/debug/renderFlags.ts),
the single build-mode gate; the stress loader and benchmark loop live beside it
in `src/debug/`. They are active in `vite dev`, and in a build made with
`VITE_RENDER_DEBUG=1` so that absolute frame times can be measured on a real
production bundle:

```sh
VITE_RENDER_DEBUG=1 pnpm exec vite build --outDir dist-perf
pnpm exec vite preview --outDir dist-perf
```

A normal `pnpm build` folds both flags to `false` and tree-shakes `src/debug/`
out of the bundle entirely (verified: the shipped chunk contains no
`renderStress`/`renderBenchmark` reference).

The benchmark records the synchronous `paintNode` section, not React, overlay,
hit-testing, save/load/export or total interaction latency. Those need separate
budgets and workloads.

### Chromium measurement (2026-07-26)

Environment: headless Chromium (Playwright shell 1228), 1280×720 viewport, one
fresh browser process per run. The 1k runs used 20 warm-up + 60 measured
frames; 10k used 10 + 20 because the deliberately unculled case costs roughly
0.8 s per frame. **Production build** (`VITE_RENDER_DEBUG=1`), DPR 1:

| Leaves | Configuration | Mean | p50 | p95 | Layers/frame | Painted decisions | Culled decisions |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1k | optimized | 51.5 ms | 51.2 ms | 57.0 ms | 20 | 560 | 150 |
| 1k | caches off | 51.5 ms | 51.1 ms | 55.1 ms | 20 | 560 | 150 |
| 1k | culling off | 79.3 ms | 78.5 ms | 85.6 ms | 33 | 1,010 | 0 |
| 10k | optimized | 73.0 ms | 71.9 ms | 84.9 ms | 25 | 572 | 1,528 |
| 10k | caches off | 76.8 ms | 76.2 ms | 85.5 ms | 25 | 572 | 1,528 |
| 10k | culling off | 769.3 ms | 764.6 ms | 837.0 ms | 318 | 10,100 | 0 |

DPR 2, production, 10k (5 warm-up + 10 measured frames): 276.0 ms optimized,
287.8 ms with caches off, 3,057.6 ms with culling off.

**Development build, same machine and session**, for comparison: 55.1 / 56.0 /
82.2 ms at 1k and 75.5 / 79.9 / 789.3 ms at 10k (optimized / caches off /
culling off). The development build is 3–7% slower, and a repeat trial of the
1k production case landed at 56.4 ms — i.e. **the dev/production difference is
inside this workload's run-to-run noise**. That is expected: the measured
section is the synchronous `paintNode` region, whose cost is dominated by
Canvas2D rasterization in the browser rather than by our JavaScript. Absolute
budgets should still be set on a production build; A/B ratios can be taken
from either.

Conclusions:

- viewport culling is the dominant win: about 1.5× at 1k, 10.5× at 10k, and
  11.1× at 10k / DPR 2;
- after culling, caches save 0–5% at DPR 1 and about 4% at DPR 2, while
  full-canvas layer compositing dominates the remaining time. The next render
  optimization to profile and prototype is tight layer bounds, not more
  JS-only caching.

“Culled decisions” counts nodes where traversal stopped; one culled group can
skip all of its descendants, so it is intentionally not `total - painted`.
Absolute timings are machine/build specific; the A/B ratios and recorded node/
layer counts are the portable part of this result.

## High-impact, structure-friendly

### 1. Viewport culling (implemented)

`paintNode` skips a node when its world bounds don't intersect the visible
rect. This is a local change with the largest likely win when zoomed into a
large document. The implementation
uses conservative visual bounds that include mitered strokes and effects,
handles rotated/flipped viewports, and exempts transient preview ancestors so
stale stored bounds cannot hide a drag preview.

### 2. Path2D caching via WeakMap (implemented)

`tracePath` rebuilds every path each frame, including `subpathSegments` for
beziers. Shapes are immutable (Zustand), so `WeakMap<Shape, Path2D>` keyed by
reference gives natural invalidation: rebuild only when the shape object
changes. `ctx.fill(path, rule)` / `ctx.stroke(path)` accept Path2D directly.
The same pattern now applies to persisted-shape culling bounds,
`layoutTextWithCanvas` results, checkerboard/pattern paints, and compound paths
with explicit component reference validation. Font-load events clear the
text-layout cache. Mutable pen/pencil previews bypass reference caches.

The cache contract is the existing immutable persisted-document model: any
future document edit must replace a changed shape/component object. Transient
tool state may mutate in place only while it continues to bypass these caches.

### 3. Tight layer bounds instead of full-canvas layers

Already flagged by PERF comments in `render.ts`: outside strokes, effects and
opacity groups each clear/draw/composite a **full-canvas-sized** layer. That
is pure fill-rate cost. Size layers to the shape's device-space bounds plus
padding (miter, blur radius × scale, shadow offset). Keep the pool but bucket
sizes (e.g. round up to powers of two) to preserve reuse.

### 4. Static-scene snapshot during interactions

During drags, pen drawing and marquees only a few shapes change, yet the whole
scene is redrawn per frame. At interaction start, bake "everything except the
moving shapes" into offscreen bitmaps; per frame, blit background layers, draw
the moving shapes, blit foreground layers, then overlay. Directly improves
drag frame rate. Needs a below/above split by z-order — the one design cost.

## Medium / low priority

- **Separate overlay canvas** for selection frames, handles and guides,
  stacked above the scene canvas. Hover/selection changes then stop repainting
  every shape (today `useEditor.subscribe` redraws the scene on any store
  change).
- **Low-quality pan/zoom mode**: while a gesture is active, transform-blit the
  last full-quality frame; re-render properly on gesture end or idle. Easy and
  feels good; trade-off is blank edges at the viewport border.
- **Blur effects**: `ctx.filter` blur is expensive. The standard approximation
  is draw-downscaled → blur → upscale-composite, increasingly valid at larger
  radii.

## Explicitly not planned

- **Dirty-rect tracking**: high complexity; culling plus the static snapshot
  captures most of the benefit for a vector editor.
- **WebGL/WebGPU migration**: maximum ceiling, massive rewrite. Only worth
  considering after the Canvas2D items above are exhausted.

## Suggested order

1. Measure with a stress document. (Instrumentation implemented; capture
   representative profiles per feature.)
2. Culling + WeakMap caches (Path2D, culling bounds, text layout, patterns) —
   implemented.
3. Tight layer bounds.
4. Static snapshot during interactions.

Step 2 stays low-coupling thanks to the immutable document model. Steps 3–4
should follow profiling because they change compositing coordinates and
interaction/render ownership, respectively.
