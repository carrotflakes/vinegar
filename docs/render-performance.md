# Canvas render performance — plan

Status: proposal, nothing implemented yet. Captures the current state of the
render pipeline and a prioritized list of optimizations.

## Current architecture (as of this writing)

- Single canvas; every store change schedules one rAF-coalesced full redraw
  (`scheduleDraw` in `src/canvas/CanvasView.tsx`).
- `renderScene` (`src/canvas/render.ts`) repaints background, grid, artboards,
  every node, preview and overlay chrome from scratch each frame.
- Partial optimizations already in place: a pool of full-canvas offscreen
  layers for compositing (opacity groups, effects, masks, outside strokes),
  and `cachedBrushEnvelope` for brush geometry.
- No viewport culling, no path caching, no static/dynamic layer split.

## Ground rule: measure first

Identify whether the bottleneck is **JS-side** (path building, text layout)
or **raster-side** (fill/stroke pixel cost, layer compositing fill rate)
before optimizing — the fixes are completely different.

- Build a stress document (thousands of shapes, effect-heavy groups, many
  outside strokes) and profile with the Chrome DevTools Performance panel.
- Two cheap counters go a long way: total `paintNode` time per frame, and the
  number of `acquireLayer` calls per frame.
- On dpr=2 large screens the app is likely fill-rate bound; JS savings won't
  help there.

## High-impact, structure-friendly

### 1. Viewport culling (likely first)

`paintNode` currently paints off-screen nodes. Skip a node when its world
bounds (cf. `unionNodeWorldBounds`) don't intersect the visible rect. Local
change, dramatic win when zoomed into a large document.

### 2. Path2D caching via WeakMap

`tracePath` rebuilds every path each frame, including `subpathSegments` for
beziers. Shapes are immutable (Zustand), so `WeakMap<Shape, Path2D>` keyed by
reference gives natural invalidation: rebuild only when the shape object
changes. `ctx.fill(path, rule)` / `ctx.stroke(path)` accept Path2D directly.
Same pattern applies to `layoutTextWithCanvas` results and `createPattern`
(currently recreated per shape per frame).

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

1. Measure with a stress document.
2. Culling + WeakMap caches (Path2D, text layout, patterns) — low risk,
   immediate.
3. Tight layer bounds.
4. Static snapshot during interactions.

Steps 1–2 are near-risk-free thanks to the immutable document model.
