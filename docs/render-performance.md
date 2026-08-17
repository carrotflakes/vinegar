# Canvas render performance — plan

Status: viewport culling, immutable-reference caches and tight temporary layers
are implemented. Interaction snapshots remain a proposal.

## Current architecture (as of this writing)

- Single canvas; every store change schedules one rAF-coalesced full redraw
  (`scheduleDraw` in `src/canvas/CanvasView.tsx`).
- `renderScene` (`src/canvas/render/scene.ts`) repaints background, grid, every
  visible node (frames included, as ordinary container nodes), preview and
  overlay chrome from scratch each frame.
- Compositing borrows tight, device-space offscreen layers for opacity groups,
  effects, masks and isolated strokes from a size-bucketed pool.
- Geometry caches: `cachedBrushEnvelope`, plus the reference-keyed Path2D,
  culling-bounds, text-layout and pattern caches described below. Layer sizing
  goes through the same shape-bounds cache; only the mutable preview shape
  bypasses it.
- Viewport culling skips off-screen subtrees, except inside symbol definitions
  (an instance is culled as a whole, its contents are not).
- No static/dynamic layer split; no dirty-rect tracking.

## Ground rule: measure first

Identify whether the bottleneck is **JS-side** (path building, text layout)
or **raster-side** (fill/stroke pixel cost, layer compositing fill rate)
before optimizing — the fixes are completely different.

- Build a stress document (thousands of shapes, effect-heavy groups, many
  outside strokes) and profile with the Chrome DevTools Performance panel.
- Three cheap counters go a long way: total `paintNode` time per frame, the
  number of `acquireLayer` calls, and total acquired layer pixels per frame.
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
  optimization families for A/B runs. Since tight layers landed,
  `renderCulling=off` only disables the explicit bounds test — a subtree that
  is composited through a layer is still skipped when its layer falls entirely
  off-target.

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

### Chromium measurement (2026-07-26, before tight layers)

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

Conclusions at that point:

- viewport culling was the dominant win: about 1.5× at 1k, 10.5× at 10k, and
  11.1× at 10k / DPR 2;
- after culling, caches saved 0–5% at DPR 1 and about 4% at DPR 2, while
  full-canvas layer compositing dominated the remaining time — which is what
  motivated tight layer bounds next, rather than more JS-only caching.

“Culled decisions” counts nodes where traversal stopped; one culled group can
skip all of its descendants, so it is intentionally not `total - painted`.
Absolute timings are machine/build specific; the A/B ratios and recorded node/
layer counts are the portable part of this result.

### Chromium measurement (2026-07-28, tight layers)

Same machine, same session, same methodology; the "before" column is a rebuild
of the pre-tight-layer commit measured back-to-back with the new one, so the
two columns are directly comparable (the 1k baseline reproduced the 2026-07-26
number to 0.1 ms). Production build, mean of the measured frames:

| Leaves | DPR | Configuration | Before | After | Speed-up |
| ---: | ---: | --- | ---: | ---: | ---: |
| 1k | 1 | optimized | 51.5 ms | 6.7 ms | 7.7× |
| 1k | 1 | caches off | 50.8 ms | 7.3 ms | 7.0× |
| 1k | 1 | culling off | 76.8 ms | 6.5 ms | 11.8× |
| 10k | 1 | optimized | 70.1 ms | 17.3 ms | 4.1× |
| 10k | 1 | caches off | 75.7 ms | 23.8 ms | 3.2× |
| 10k | 1 | culling off | 744.6 ms | 28.6 ms | 26.0× |
| 10k | 2 | optimized | 280.2 ms | 46.6 ms | 6.0× |
| 10k | 2 | caches off | 276.3 ms | 48.0 ms | 5.8× |
| 10k | 2 | culling off | 2,923.9 ms | 54.0 ms | 54.1× |

Layer fill area per frame, the counter this change added
(`meanAcquiredLayerPixels`). The "before" figures are derived, not measured —
the old code always allocated target-sized layers, so they are exactly
`acquireLayerCalls × canvas pixels`:

| Case | Layers/frame | Before (derived) | After (measured) | Reduction |
| --- | ---: | ---: | ---: | ---: |
| 1k, DPR 1 | 20 | 18,432,000 px | 671,232 px | 27.5× |
| 10k, DPR 1 | 25 | 23,040,000 px | 1,489,792 px | 15.5× |
| 10k, DPR 2 | 25 | 92,160,000 px | 5,856,768 px | 15.7× |

Conclusions:

- tight layers are a larger win than culling was: 4–8× on the optimized
  configurations, and the DPR 2 case is no longer catastrophic (280 ms → 47 ms).
  The scene was indeed fill-rate bound, and the fill was almost all compositing
  overdraw rather than shape pixels;
- the balance has flipped. With fill cost down, the reference caches now matter
  measurably at DPR 1 (17.3 ms vs 23.8 ms at 10k, ~27%) where they were within
  noise before, while at DPR 2 they stay at ~3%;
- **`renderCulling=off` is no longer a clean isolation of culling.** A layer
  request whose device bounds fall entirely outside the target returns no
  layer, and the composited subtree is then skipped — visible in the counters
  as 10,100 → 8,500 painted decisions and 318 → 25 layers at 10k. Tight layers
  imply a second, coarser culling path that the switch cannot turn off.

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

### 3. Tight layer bounds instead of full-canvas layers (implemented)

Outside strokes, aligned text strokes, effects and opacity/blend groups now
borrow layers clipped to their conservative device-space visual bounds.
Bounds include miter, blur and shadow reach plus an antialiasing pixel. Canvas
dimensions are rounded up to power-of-two buckets (capped by the current
target), while an origin offset keeps drawing and compositing in the original
device coordinate system. Nested layers therefore stay tight as well.

`acquiredLayerPixels` is recorded beside `acquireLayerCalls`, including in the
benchmark samples and summary, so fill-area reductions can be compared even
when the number of compositing passes is unchanged.

**Behaviour change:** effect radii on a *shape* are now interpreted in the
shape's own local space (`compositeEffects` gets `deviceScale(ctx)` multiplied
by the shape transform's scale). Group effects always worked that way, because
their `deviceScale` is read after `ctx.transform(node.transform)`, and the
culling bounds always assumed it too. A blur on a scaled shape therefore
renders differently — consistently with groups — than it did before.

Effect halos are sized in **device space**, where the radius is exact:
`nodeLocalContentBounds` returns a node's content without its own halo, and
each acquire site adds `effectsMargin(effects) * scale` device pixels using the
very scale it then hands to `compositeEffects`. This matters under non-uniform
scale — the canvas filter blurs isotropically in device pixels, so a margin
expanded in local space and then squashed by e.g. `scale(1, 0.1)` would clip
the halo vertically. Nested nodes are still folded into their parent's bounds
in local space; there the margin is widened by `localEffectScale` (the
transform's max-scale over `sqrt(|det|)`, i.e. 1 for uniform scale and
rotation) so the compressed axis still covers the halo.

The pool is capped at `MAX_POOLED_LAYERS` canvases and evicts from the least
recently used size bucket. Without that, a session that visits many bucket
sizes — or resizes the target, which changes the size clamp — would retain a
canvas per size for the life of the page.

### 3b. Only isolate the stacks that need it (implemented)

Having an effect stack and needing an isolation layer are two different things.
`needsEffectIsolation` (`model/effects.ts`) draws the line: pixel effects (blur,
shadow, colour) filter what is below them and so need those pixels alone on a
layer, while geometry effects (fill, stroke) only *add* paint and can go
straight onto the target — unless one blends, which must mix with the node's own
artwork and stop there. The node's own opacity and blend mode force isolation
too, because they composite the finished stack as one group (as SVG export does
with them, so the direct route would make the two disagree).

One case goes the other way, for a correctness reason rather than a stacking
one. Chrome on Android drops an advanced blend made under a **path clip** whole
once the clip's device bounds pass the driver's limit — zooming in on the demo
document's clipped "MASKED" text (blend `overlay` inside a star-masked group)
made it vanish abruptly, while the same blends outside a mask kept rendering. So
a masked group whose subtree contains a non-normal `blendMode` (`subtreeBlends`
in `render/scene.ts`) isolates even at full opacity with no effects, and applies
its mask as a `destination-in` alpha pass over its finished layer instead of as
a clip on the target. The blend then runs unclipped. Masked groups without a
blend under them keep the free clip route.

A shape with an ordinary stroke effect therefore acquires **no** layer at all —
only its own alignment layer if the stroke is inside/outside. This matters more
than it looks: [effects.md](effects.md) is heading toward the shape's own
`fill`/`stroke` moving into the stack, at which point *every* shape would carry
effects. Gating on "has entries" would have put the entire scene through the
layer pool. `tests/renderPerformance.test.mjs` pins the layer counts.

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

## Layers panel windowing (implemented)

The panel is a second cost centre: an SVG import can put thousands of rows in
the DOM, and each row is a handful of elements. `flattenRows` (see
`src/ui/panels/layers/tree.ts`) turns the display tree into a flat list, and the
panel renders only the slice around the viewport once there are more than 100
rows, with a spacer box holding the total height.

Two facts it depends on:

- **Rows are uniform in height**, so an index is a pixel offset. The height is
  measured from the first rendered row rather than hard-coded, so a stylesheet
  change cannot silently desynchronise it.
- **The scroll container is whatever is actually clipping.** Depending on the
  dock layout that is the list itself or an ancestor (`.dock-body` stacks
  several panels and scrolls them together), so it is resolved by walking up
  from the list and the window is measured against that element. Scroll events
  are watched on the capture phase, since they do not bubble.

The drop indicator is placed by row index instead of being inserted between
rows — inserting an element would shift every offset computed from that index.
Measured with 1500 shapes: ~20 rows in the DOM instead of 1500.

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
3. Tight layer bounds — implemented.
4. Static snapshot during interactions — next.

Step 2 stays low-coupling thanks to the immutable document model. Step 3
changes compositing coordinates and is covered by focused layer-size tests.
Step 4 changes interaction/render ownership and should follow interaction
profiling.
