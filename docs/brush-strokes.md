# Brush strokes (pressure / variable width) — design

Status: Phases 1 & 2 shipped (file v19). The `brush` leaf, envelope renderer,
bounds/hit-testing, serialization, SVG export and the Brush tool (coalesced
sampling, pressure curve, EMA stabilizer, taper, width-aware fit, minimal palm
rejection) all landed, plus stroke collection into an active drawing group
(see "Stroke container" below), the vector eraser, and node-tool editing of
brush anchors (move/insert/delete/smooth-toggle with the width preserved; a
brush is treated as one open subpath) including per-anchor width knobs. Brushes convert to paths two ways (`src/model/brush/convertBrush.ts`).
**"Convert to path"** is the geometry-faithful direction, shared with every
other shape: it makes an open uniform-width stroked path from the centerline
(`stroke`/`strokeWidth` carried, per-anchor `w` dropped), so it pairs with
**"Convert to brush"** (path→brush, `w: 1` everywhere, `strokeWidth` as the base
width, several contours wrapped in a group like Split subpaths) as a lossy
round-trip of the centerline. **"Convert to outline path"** is the separate,
appearance-preserving direction: it fills the variable-width envelope ring with
the `stroke` paint under the nonzero rule (this was the old brush behaviour of
"Convert to path"). Phase 3
remainder: an incremental preview envelope. Deviations from the original draft below: brush
size lives in a dedicated persisted `brushStore` (not the shared style
`strokeWidth`); the Brush tool binds `B` and Pencil moved to `Shift+B`.

The goal is drawing-tablet freehand strokes whose width follows pen pressure,
kept **non-destructive and vector**: the document stores an editable centerline
with a width profile, and every consumer (canvas, SVG, bounds, hit-testing)
derives the filled outline from it. This is the Illustrator width-profile /
Inkscape PowerStroke model, not a raster brush.

## Decisions up front

- **New leaf shape `type: "brush"`**, not an extension of `path`.
  Variable width is incompatible with almost every uniform-stroke feature
  (dash, cap/join, inside/outside alignment, `ctx.stroke()` itself); grafting a
  width array onto existing shapes would force every stroke code path to
  branch. A dedicated leaf keeps `path` untouched and slots into the
  existing switch statements as one new case each.
- **Separate Brush tool**, keyboard `B`. The pencil keeps producing uniform
  ordinary paths (Illustrator also ships pencil and paintbrush side by side).
- **Width lives on the shape as a profile, paint comes from `stroke`.** The
  envelope is *filled* on screen, but semantically it is a stroke: the shape's
  `stroke` paint colors it and `strokeWidth` is the base width. Per-anchor
  values are normalized multipliers, so the existing stroke-width field scales
  a whole stroke and the pressure profile survives unchanged.
- **Pressure maps to width only.** Pressure→opacity is deferred: per-segment
  alpha does not composite cleanly in a vector envelope (overlaps double-blend).
- **The envelope may self-intersect and that is fine.** It is filled with the
  nonzero winding rule (Canvas default, SVG default), which renders sharp turns
  correctly without any polygon clipping at draw time. Clipper is only needed
  for the destructive Outline Stroke conversion.

## Data model

```ts
/** One anchor of a brush centerline: a cubic Bézier anchor plus width. */
export interface BrushAnchor {
  p: Vec2;
  hIn: Vec2 | null;
  hOut: Vec2 | null;
  /** Optional cusp/smooth/symmetric linkage; absent means geometry-derived. */
  t?: AnchorType;
  /** Width multiplier at this anchor, ≥ 0; 1 = full strokeWidth. */
  w: number;
}

/** Pressure-profiled freehand stroke. Always an open centerline in v1. */
export interface BrushShape extends BaseShape {
  type: "brush";
  anchors: BrushAnchor[];
}
```

- Geometry reuses the `path` anchor convention (absolute handles in local
  space, `null` = corner, optional `t` = handle linkage), so
  `subpathSegments`-style code, the node tool and Catmull-Rom fitting transfer
  directly.
- Effective width at an anchor is `strokeWidth × w`; between anchors `w`
  interpolates linearly in the segment parameter `t`. `w` may exceed 1 (future
  width-tool edits) but capture clamps pressure to 0..1.
- `fill` is unused in v1 (stays `null`); dash/cap/join/alignment fields are
  ignored (ends are always round caps in v1). `supportsStrokeAlignment`
  returns false; the properties panel hides the stroke-detail rows for brush
  shapes.
- Anchors stay as objects (not flat arrays) for consistency with `path`;
  post-fit strokes are ~10–50 anchors, so file size is not a concern.

### Serialization

- `CURRENT_FILE_VERSION` → 19. Additive: no migration for older files; the
  bump only marks that files containing brush nodes need a v19 reader.
- `serialize.ts` validation accepts the new node type; `docs/document-model.md`
  gains a bullet describing brush invariants (open centerline, `w ≥ 0`,
  `stroke` paints the envelope).

## Envelope geometry (`model/brushOutline.ts`)

Single source of truth shared by render, SVG export, bounds and hit-testing,
mirroring how `outlineStroke.ts` is shared today.

1. **Flatten** the centerline with the existing cubic sampling
   (`subpathSegments` / `cubicPoint`, ~18 steps per segment), carrying an
   interpolated width per sample.
2. **Offset**: at each sample compute the unit normal (average of adjacent
   segment normals); emit `p ± n · (strokeWidth · w / 2)`. Left side forward
   plus right side reversed forms one closed ring.
3. **Caps**: semicircular fans (radius = endpoint half-width) at both ends.
   Zero-width tips (tapers) collapse to the centerline point — no fan.
4. **Sharp turns** self-intersect; nonzero fill hides it. If flat sampling
   shows faceting on tight curves, insert extra fan points where the turning
   angle between samples exceeds ~20°; no Clipper in the live path.

Caching: because store edits are immutable, a `WeakMap<BrushShape, …>` keyed
on shape identity is correct and self-invalidating. Cache the envelope ring
(`Vec2[]`) in the model layer for bounds/hit-testing, and a `Path2D` in the
canvas layer for painting (same split as `imageCache.ts`).

## Rendering (`canvas/render/`)

- `tracePath` case `"brush"`: append the cached envelope ring;
  `paintShape` fills it with the resolved `stroke` paint (solid / gradient /
  pattern all work — paints are already local-space) using nonzero winding,
  and skips the `ctx.stroke()` pass.
- Opacity, blend mode, effects, clip groups and symbols all compose through
  `paintNode` unchanged because brush is an ordinary leaf.

## Bounds, hit-testing, snapping

- `shapeBounds` case `"brush"`: bounds of the cached envelope ring (caps and
  width included), so `strokeOutset` returns 0 for brush.
- `hitTestShape` case `"brush"`: nonzero winding test against the envelope
  ring (`polygonWinding` sum ≠ 0 — **not** the even-odd `pointInPolygon`,
  which would punch holes at self-intersections), plus `distToPolyline`
  against the ring for the tolerance band.
- `localPolylines` (marquee) returns the envelope ring; snapping treats brush
  like `path` (anchor points as snap sources, none as targets in v1).

## Capture pipeline (Brush tool, `canvas/tools/brushTool.ts`)

Live state is a preview shape outside the store (like pencil), so the commit
is one `addShape` = one undo step.

1. **Sampling** — on `pointermove`, drain
   `e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]` so fast strokes
   keep their full sample density instead of one point per frame. Each sample:
   world position + pressure. Min-distance filter in **screen** pixels
   (`~1.2 / viewport.scale` in world units); the pencil now drains the same
   coalesced samples and filters the same way.
2. **Pressure normalization** — `pointerType === "pen"` uses raw
   `e.pressure` through the brush's pressure curve; mouse/touch report a
   constant (0.5 or 0), so force pressure = 1 there. Curve v1 is a gamma
   `wNorm = minWidth + (1 − minWidth) · pressure^γ` with user-set γ (0.25–4)
   and minimum-width fraction.
3. **Stabilizer** — exponential moving average on position, strength 0–1 from
   tool options. 0 disables. The strength is
   defined *per 60 Hz frame* and each sample keeps `s^(dt/16.7ms)` of the
   error, so a 240 Hz stylus and a 60 Hz mouse produce the same line at the
   same setting — a per-sample average would barely smooth the stylus. The
   pencil's smoothing works identically. (A pull-string stabilizer can replace
   EMA later without changing anything downstream.) Width gets its **own,
   lighter** average (`PRESSURE_RETAIN`, a fixed ~16 ms constant, not the
   stabilizer setting): it smooths the *sensor*, whose noise the envelope would
   otherwise show as bulges, and it must stay fast because width is what makes
   a stroke read as pressed. Both averages advance on every sample, including
   the ones the min-distance filter drops — their pressure is part of the
   stroke even where their position adds nothing, so pressing harder while
   barely moving still thickens the line.
4. **Preview** — the preview `BrushShape` holds the dense samples as
   handle-less anchors; the envelope is rebuilt per move (O(n), fine for
   thousands of points; an incremental tail rebuild is a later optimization).
   Mutating the preview in place is safe because the WeakMap caches are only
   consulted for committed (immutable) shapes — the preview render path
   builds its envelope directly.
5. **Commit** (`pointerup`):
   - **tail settlement**: the average trails the pointer, so the capture is
     first walked the rest of the way to the release point in 60 Hz steps
     (`settleTail`, the same idea as the pencil's). Without it a stroke ends
     short of where the pen was lifted — barely at the default stabilizer,
     visibly at high settings — and the end of a stroke is what people aim.
     The width holds at its last smoothed value: pens report a meaningless
     pressure (usually 0) on release, and the taper is what shapes the tip;
   - optional **taper**: scale `w` down to 0 over a configured arc length at
     the start/end (this is what makes mouse strokes look drawn, 入り抜き);
   - **width-aware simplification**: RDP on position (existing
     `simplifyPath`, ε = the tool's Simplify tolerance in screen px ÷ scale,
     default 2 — the Pencil tool has the same option), then re-insert dropped points where the
     linearly-interpolated width error exceeds a threshold (≈ 0.05) so
     pressure peaks survive;
   - **fit**: Catmull-Rom handles via the existing `pointsToAnchors` scheme,
     extended to carry `w` through;
   - build the `BrushShape` (open, round caps) and `state.addShape`.
6. **Palm rejection (minimal)** — while a pen-pointer stroke is live, ignore
   `pointerdown` from `touch` pointers instead of promoting to the two-finger
   gesture (which today would cancel the stroke). Full pen/touch role
   separation is a separate work item.

### Stroke container (active drawing group)

Committed strokes collect into a container group instead of littering the scene
root, reusing the existing **`activeGroupId`** (the drilled-into group) as the
target — no brush-specific state. `addBrushStroke` (store): if `activeGroupId`
is a valid group, append the stroke there; otherwise create a fresh **"Drawing"**
group at the current scope, put the stroke inside, and set it active so
consecutive strokes chain into it. Exiting the group (Esc / `exitGroup`, or
clicking outside it with the Select tool) clears `activeGroupId`, so the next
stroke starts a new group; double-clicking into any existing group makes it the
target. Each commit is one history step (the group + first stroke transact
together). `setTool` leaves `activeGroupId` intact, so the target survives
tool switches.

Tool options (persisted in `store/brushStore`, localStorage): base size (the
stroke's own `strokeWidth`, not the shared style), pressure γ, min width %,
stabilizer strength, taper length. UI: `BrushSection` shown in the properties
panel while the brush tool is active; a proper brush preset system is out of
scope for v1. Off-panel, `[` / `]` step the size by ×1.2 while the brush or
eraser is active (the same chords the node tool uses for anchor widths — the
contexts are disjoint, and `matchKeydown` resolves a shared chord to the command
that is currently enabled). A tip ring follows the pointer for pen **and mouse**
(`updateBrushHover`): the size is in world units, so how thick a stroke lands
depends on the zoom, and the ring is the only way to know before drawing. Touch
cannot hover, so it goes without.

## SVG export / import

- Export: one `<path d="…" fill="…(stroke paint)" fill-rule="nonzero"/>` from
  the same envelope ring, transformed by the node matrix like every other
  shape. Self-intersecting `d` is valid SVG. An optional "clean outline"
  (Clipper union) can come later for tools that dislike self-intersections.
- Import: nothing to do — foreign SVGs carry outlined strokes already.

## Editing model

- **Select tool**: transforms work as for any leaf. The single-shape resize
  fold (`soloLeaf`) folds uniform scale into anchor geometry and multiplies
  `strokeWidth` like other stroked leaves; non-uniform scale stays in
  `transform` (widths cannot shear).
- **Node tool** (shipped): brush anchors reuse the path anchor/handle
  editing. `model/nodeEdit.ts` exposes a `NodeEditShape = PathShape | BrushShape` view
  (`nodeSubpaths` presents a brush as one open subpath); `hitNodes` /
  `moveAnchor` / `moveHandle` and the `drawNodes` overlay all operate on it, and
  `picking.selectedNodeShape` lets the node tool pick a brush. Moves preserve
  each anchor's `w` (spread through). Structural edits live in
  `model/brushEdit.ts` (`closestPointOnBrush`, `insertBrushAnchor`,
  `deleteBrushAnchor`, `toggleBrushAnchorSmooth`), mirroring the path ops but
  carrying `w`: clicking the path inserts an anchor (width linearly
  interpolated; de Casteljau split keeps the curve exact), Delete removes the
  active anchor (or the whole brush below two), and double-click toggles
  corner/smooth.
- **Per-anchor width editing** (shipped): each *selected* brush anchor grows a
  pair of width knobs, offset along the centerline normal by the local
  half-width (`strokeWidth × w / 2`) — the Illustrator Width Tool / Inkscape
  PowerStroke idiom, minus asymmetric sides, which the single scalar `w` cannot
  express. Knobs are drawn as diamonds in their own hue so they read apart from
  the tangential Bézier handles, and only on the selection: a fitted freehand
  stroke has dozens of anchors and knobs on all of them would bury the artwork.
  A knob never sits closer than `WIDTH_KNOB_MIN_PX` to its anchor so hairline
  anchors stay grabbable. That nudge moves the drawn position only, so the drag
  captures a *grab offset* at pointer-down (how far the grab point sits beyond
  the anchor's true half-width) and subtracts it throughout: without it the
  width would jump on the first pixel of movement, which at the default brush
  size — half-width 4px against a 7px minimum — is the common case, not an edge
  case. The offset also absorbs grabbing a knob slightly off-center, making the
  whole drag relative. Pick order is Bézier handle → width knob → anchor. Dragging scales *every* selected anchor by the grabbed one's
  ratio, preserving the taper; Alt levels them to one absolute width instead
  (also the fallback when the grabbed anchor starts at zero, where no ratio
  exists). Geometry helpers live in `model/brush/brushWidth.ts`, knob placement
  and hit-testing in `canvas/nodes.ts`, the drag in `canvas/tools/nodeTool.ts`
  (`node-width` interaction). Off-canvas: `[` / `]` step the selection by ×1.2,
  and the Node width panel section gives an absolute figure for a single brush.
  Still deferred: a "rub to thicken" width brush, which scales better than
  per-vertex knobs for dense freehand strokes.
- **Convert to path** on a brush (shipped): copy the same cached envelope used
  by rendering and hit-testing into a data-driven nonzero `PathShape`. This
  preserves self-intersections exactly as rendered and unlocks ordinary path
  editing and boolean operations; the pressure-aware centerline is discarded.
  Brush shapes themselves stay out of `PrimitiveShape` and out of boolean/
  compound-path inputs until converted.
- **Vector eraser** (Eraser tool, `E`): a centerline-split eraser. The drag is
  a world-space path of radius `eraserSize / 2`; `eraseBrush` (`model/eraser.ts`)
  samples each overlapped centerline adaptively to locate entry/exit parameters,
  then splits the original cubic segments at those boundaries with de Casteljau
  subdivision. Surviving spans retain their exact control points and linearly
  interpolated width profile instead of being re-fitted, so repeated erasing
  does not accumulate shape error. The pieces keep the original style/transform
  and remain variable-width brushes, not polygons. `eraseBrushStrokes` (store)
  substitutes them in place within the parent and commits one undo step. A brush
  the eraser never touches is returned unchanged (`null`); a fully covered one
  is removed. Deferred: erasing plain paths/beziers, an area (boolean-subtract)
  hard-eraser mode, and cutting by the brush's own width rather than the bare
  centerline (grazing a thick stroke's edge does not cut).
- Closed brush loops, speed-simulated pressure, tilt, and the scripting API for
  brush nodes are all deferred.

## Testing (ask before writing, per AGENTS.md)

Candidate `node:test` coverage: envelope of a straight two-anchor stroke is a
capsule with the expected bounds; zero-width taper tips produce no cap fan;
hit-testing inside a self-intersecting hairpin still reports a hit; width-aware
simplification keeps a mid-stroke pressure spike; v19 round-trip through
`serialize.ts`; SVG export emits a nonzero-fill path with the stroke paint.

## Phasing

1. **Model first**: types + envelope builder + render + bounds/hit +
   serialize v19 + SVG export. Verifiable with a hand-built document before
   any tool exists.
2. **Brush tool**: capture pipeline, coalesced events, pressure curve,
   stabilizer, taper, tool options UI.
3. **Polish**: node-tool integration, Outline Stroke conversion, incremental
   preview envelope, width knobs.
