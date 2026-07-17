# Brush strokes (pressure / variable width) — design

Status: Phases 1 & 2 shipped (file v19). The `brush` leaf, envelope renderer,
bounds/hit-testing, serialization, SVG export and the Brush tool (coalesced
sampling, pressure curve, EMA stabilizer, taper, width-aware fit, minimal palm
rejection) all landed, plus stroke collection into an active drawing group
(see "Stroke container" below). Phase 3 polish (node-tool width editing, Outline
Stroke conversion, incremental preview envelope) remains open. Deviations from the
original draft below: brush size lives in a dedicated persisted `brushStore`
(not the shared style `strokeWidth`); the Brush tool binds `B` and Pencil moved
to `Shift+B`.

The goal is drawing-tablet freehand strokes whose width follows pen pressure,
kept **non-destructive and vector**: the document stores an editable centerline
with a width profile, and every consumer (canvas, SVG, bounds, hit-testing)
derives the filled outline from it. This is the Illustrator width-profile /
Inkscape PowerStroke model, not a raster brush.

## Decisions up front

- **New leaf shape `type: "brush"`**, not an extension of `path`/`bezier`.
  Variable width is incompatible with almost every uniform-stroke feature
  (dash, cap/join, inside/outside alignment, `ctx.stroke()` itself); grafting a
  width array onto existing shapes would force every stroke code path to
  branch. A dedicated leaf keeps `path`/`bezier` untouched and slots into the
  existing switch statements as one new case each.
- **Separate Brush tool**, keyboard `B`. The pencil keeps producing uniform
  `bezier` lines (Illustrator also ships pencil and paintbrush side by side).
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
  /** Width multiplier at this anchor, ≥ 0; 1 = full strokeWidth. */
  w: number;
}

/** Pressure-profiled freehand stroke. Always an open centerline in v1. */
export interface BrushShape extends BaseShape {
  type: "brush";
  anchors: BrushAnchor[];
}
```

- Geometry reuses the `bezier` anchor convention (absolute handles in local
  space, `null` = corner), so `subpathSegments`-style code, the node tool and
  Catmull-Rom fitting transfer directly.
- Effective width at an anchor is `strokeWidth × w`; between anchors `w`
  interpolates linearly in the segment parameter `t`. `w` may exceed 1 (future
  width-tool edits) but capture clamps pressure to 0..1.
- `fill` is unused in v1 (stays `null`); dash/cap/join/alignment fields are
  ignored (ends are always round caps in v1). `supportsStrokeAlignment`
  returns false; the properties panel hides the stroke-detail rows for brush
  shapes.
- Anchors stay as objects (not flat arrays) for consistency with `bezier`;
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

## Rendering (`canvas/render.ts`)

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
   (`~1.5 / viewport.scale` in world units) — the current pencil filters in
   world units, which drops detail when zoomed out.
2. **Pressure normalization** — `pointerType === "pen"` uses raw
   `e.pressure` through the brush's pressure curve; mouse/touch report a
   constant (0.5 or 0), so force pressure = 1 there. Curve v1 is a gamma
   `wNorm = minWidth + (1 − minWidth) · pressure^γ` with user-set γ (0.25–4)
   and minimum-width fraction.
3. **Stabilizer** — exponential moving average on position (and a lighter one
   on pressure), strength 0–1 from tool options. 0 disables. (A pull-string
   stabilizer can replace EMA later without changing anything downstream.)
4. **Preview** — the preview `BrushShape` holds the dense samples as
   handle-less anchors; the envelope is rebuilt per move (O(n), fine for
   thousands of points; an incremental tail rebuild is a later optimization).
   Mutating the preview in place is safe because the WeakMap caches are only
   consulted for committed (immutable) shapes — the preview render path
   builds its envelope directly.
5. **Commit** (`pointerup`):
   - optional **taper**: scale `w` down to 0 over a configured arc length at
     the start/end (this is what makes mouse strokes look drawn, 入り抜き);
   - **width-aware simplification**: RDP on position (existing
     `simplifyPath`, ε ≈ 2/scale), then re-insert dropped points where the
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
stabilizer strength, taper length. UI: `BrushPanel` shown in the properties
panel while the brush tool is active; a proper brush preset system is out of
scope for v1.

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
- **Node tool**: brush anchors reuse the bezier anchor/handle editing
  (`moveAnchor` / `moveHandle` generalize over `{p, hIn, hOut}`); `w` rides
  along untouched. Per-anchor width editing (an Illustrator-style width tool)
  is deferred.
- **Outline Stroke** on a brush: Clipper-union the envelope into a
  `PolygonShape` (extends the existing command), which also unlocks boolean
  ops — brush shapes themselves stay out of `PrimitiveShape` and out of
  boolean/compound-path inputs.
- Eraser, closed brush loops, speed-simulated pressure, tilt, and the
  scripting API for brush nodes are all deferred.

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
   preview envelope, width tool.
