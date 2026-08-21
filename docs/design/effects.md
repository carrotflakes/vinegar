# Effects

Status: **implemented**. Fill / Stroke effects added at file version **v37**;
per-entry bypass at **v39**.
Related: [document-model.md](../document-model.md),
[render-performance.md](../reference/render-performance.md) (layer pool, effect margins),
[path-modifiers.md](path-modifiers.md) (the geometry counterpart of this stack).

`BaseNode.effects` is an ordered, non-destructive appearance stack on **any**
node. It is evaluated after the node's content is rendered and before its
opacity/blend composite:

```
content → effect[0] → effect[1] → … → opacity + blendMode → parent
```

Stack order is paint order, so a later entry always sees the earlier ones.

## Entries have stable ids

Every effect carries an `id`, unique within its node and fixed for the life of
the entry. An array index is not an identity: reordering the stack would move a
parameter binding, a live input's state or an undo coalescing key onto a
different effect. The id is what those address instead. Nothing reads it across
nodes, so duplicating a node keeps its copies' ids.

Load rejects a missing or repeated id, so an ambiguous address can never enter
the document. `defaultEffect(type)` mints one; construct effects through it.

Two consumers use it today — the properties panel's React keys and the paint
field's remembered paint kind — and one is coming: appearance-stack field paths
for `node.bindings` (`parameters.md`) once the shape's own `strokeWidth`
moves into the stack.

## Entries can be bypassed

Every effect carries `enabled`; `false` bypasses it without removing it from the
stack, so its parameters survive an "off, look, on again". The field is
**required and stored explicitly**, like `blendMode: "normal"` and unlike a path
modifier's optional `enabled?` — effects were versioned into v39 together, so
there is no absent case to define a default for, and load rejects a stack
missing it. The card control is the shared `StackCard`, same as a modifier's
([path-modifiers.md](path-modifiers.md)).

`activeEffects(effects)` drops the bypassed entries and is what every reader
that *applies* the stack goes through — directly (canvas `paintNode`, SVG
`shapeToSvg`) or via `pixelEffects` / `effectsMargin`, which fold it in. It
returns the very same array when nothing is bypassed, so the common case
allocates nothing. Rendering, bounds and export have to agree on what the stack
produces, so a reader that filters `enabled` itself instead is a bug waiting to
happen: it would put a bypassed drop shadow back into the export's crop.

The paint walkers deliberately do **not** filter: `nodePaints` / `mapNodePaints`
see bypassed entries too. A bypassed fill still references its pattern asset or
global colour, and pruning that on save would lose it for good.

## Two kinds share the stack

| | pixel effects | geometry effects |
| --- | --- | --- |
| entries | `blur`, `drop-shadow`, `color-adjust`, `tint` | `fill`, `stroke` |
| input | the pixels produced so far | the node's **own outline** |
| canvas | a filter/composite into a new offscreen layer | painted onto the layer in hand |
| SVG | `<filter>` primitives | sibling elements with the same geometry |
| applies to | every node | only nodes with an outline |

A **fill** effect paints the node's geometry with a full `Paint` (solid,
gradient, freeform, pattern, swatch reference) over whatever is below it in the
stack. A **stroke** effect runs a pen along the same geometry with its own
`width`, `alignment`, `cap` and `join` — deliberately independent of the shape's
`stroke*` fields, so a shape can carry several outlines at different widths.
Both take `paint: Paint | null`, where `null` paints nothing, exactly like a
shape's own `fill`/`stroke`.

Both also carry their own `blendMode`, which is how the pass composites onto
what the stack has produced below it — a multiply fill that darkens the artwork
it sits on, say. A stroke composites **as a whole**, so an off-centre pass never
blends with the half of itself that alignment cuts away. Pixel effects have no
blend mode: they transform their input rather than composite onto it.

Two blend modes are in play and they are not the same thing: the effect's
`blendMode` mixes it with the node's own artwork inside the stack, while
`node.blendMode` mixes the finished result with the rest of the scene.

### Tint is not a fill

`tint` and a solid `fill` agree on one case — a single flat colour over an
opaque shape — and diverge everywhere else. The line between them is the same
one that separates the two families: **a colour *filter* versus a colour
*source*.**

| | Tint | Fill |
| --- | --- | --- |
| adds coverage | **no** — repaints pixels that are already there | **yes** — paints the whole interior, empty or not |
| applies to | every node: images, live text, a whole group | only nodes with an outline |
| paint | one solid colour | any paint, plus a blend mode |
| a blur's soft halo | tinted in proportion to its falloff | a hard geometry edge stamped over it |

The first two rows are the ones that matter. Tint is the only way to recolour
content that has no outline to fill, and the only way to recolour a stack's
result without redrawing the silhouette over it. Neither absorbs the other, and
the name says which is which — it was called `color-overlay` until `fill`
arrived and made the overlap read as duplication.

### Nodes with no outline

Groups, frames, instances, images and live text have no vector outline, so
fill/stroke entries on them are **inert** — kept in the stack (they stay
reorderable, and survive a copy to a shape) but never painted. The predicate is
`paintsGeometryEffects(shape, doc)`, which is just "does `shapeSubpaths` return
an outline". The properties panel says so on the effect's card.

`pixelEffects(effects)` is the matching filter for readers that can only apply
pixel effects. Two things depend on it:

- SVG renders a childless `<filter>` as transparent black, so a stack that is
  *only* geometry effects must emit no filter at all rather than an empty one.
- A container whose stack reduces to nothing must not pay for an isolation
  layer.

## Order and the SVG split

Canvas follows the stack directly: a geometry effect draws onto the current
layer, so the next pixel effect picks it up.

SVG cannot, because a `<filter>` is one attribute on one element. `shapeToSvg`
therefore splits the stack into runs: each run of pixel effects wraps everything
emitted so far in its own filtered `<g>`, and each geometry effect appends a
sibling drawn from the same geometry. Nesting the wrappers is what keeps
`[blur, stroke]` (a sharp stroke around blurred artwork) distinct from
`[stroke, blur]` (both blurred).

```
[blur, fill]  →  <g><g filter="url(#fx0)">ART</g>FILL</g>
[fill, blur]  →  <g><g filter="url(#fx0)">ART FILL</g></g>
```

## Isolation

Carrying an effect stack does not by itself mean the node needs an isolated
offscreen layer. `needsEffectIsolation(effects)` says when it does:

| stack | painted |
| --- | --- |
| any pixel effect | on a layer — it filters the pixels below it |
| a geometry effect with a non-normal blend | on a layer — the blend must stop at the node's own artwork |
| geometry effects, all `normal` | straight onto the target, in order |

The node's own opacity and blend mode force isolation as well, since they
composite the finished stack as one group — which is what SVG export does with
them too, so painting the passes directly would make the two disagree.

This is what keeps an ordinary stroke effect off the layer pool, and it is a
precondition for ever moving the shape's own `fill`/`stroke` into the stack: at
that point every shape would carry effects, and gating on "has entries" would
route the whole scene through offscreen layers. See
[render-performance.md](../reference/render-performance.md#3b-only-isolate-the-stacks-that-need-it-implemented).

## Shared mechanics

- **Geometry** comes from the canonical derivation only — `cachedShapePath` /
  `tracePath` on canvas, `shapeGeometryToSvg` in export. Neither side
  re-derives it, so a stroke effect follows modifier stacks and brush envelopes
  for free.
- **Stroke alignment** reuses the shape's own machinery. Canvas has no
  inside/outside pen, so `strokeShapeGeometry` strokes at double width and cuts
  the wrong half away (clip for inside, a punched-out layer for outside); SVG
  does the same with `clipPath`/`mask`. The shape's own stroke and every stroke
  effect go through that one function. Alignment falls back to `center` on open
  geometry, like `effectiveStrokeAlignment`.
- **Blend isolation.** On canvas the stack runs on a layer holding nothing but
  the node, so an effect's blend mode reaches its own artwork and stops. SVG has
  no such boundary — `mix-blend-mode` would blend with the page behind the node
  — so the wrapping `<g>` carries `isolation: isolate`. It keeps
  `node.blendMode` on the same element: isolation bounds the *children's*
  blending without affecting how the group itself blends outward.
- **Paint references.** An effect paint can be a pattern (an asset reference) or
  a global colour (a swatch reference), so every walker that collects or
  rewrites references goes through `nodePaints` / `mapNodePaints`
  (`model/scene.ts`) rather than reading `fill`/`stroke`. A walker that misses
  one is not cosmetic: save-time orphan pruning would drop the asset, and
  deleting a swatch would leave a dangling reference that silently paints
  nothing. This holds for containers too — a group's fill effect paints nothing
  but its reference is still real document data.
- **Lengths are node-local**, so a stroke effect's width scales with the
  transform chain like `strokeWidth`.
- **Bounds**: `effectsMargin` adds `strokeEffectOutset` (the same conservative
  miter multiplier as `strokeOutset`) so culling and export do not crop a wide
  outside stroke. A fill effect adds nothing — it stays inside the geometry.

## Deliberate limits

- **Hit-testing and the selection frame ignore effects**, geometry effects
  included: a shape with a 20-unit outside stroke effect is still picked by its
  own outline. This matches how blur and drop shadow already behave.
- **Text and images** are the interesting gap. Both are bounds-shaped content
  today; giving text a fill/stroke effect means painting glyph runs (canvas) and
  emitting a second `<text>` (SVG), which is a separate change.
