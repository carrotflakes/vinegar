# Path modifiers

Status: **implemented** (2026-08-02); extended to `rect`/`ellipse`/`line`
(2026-08-06). File version: **v33** (additive shape field, but Vinegar's strict
current-only file policy requires a version bump; absent `modifiers` still
means no change). Related: extends the generator concept
([document-model.md](document-model.md)); modeled on `effects`; overlaps
[path-unification.md](path-unification.md) (v21) and
[compound-path-nodes.md](compound-path-nodes.md) (v22).

## Problem / motivation

Path cleanups (Simplify, Flatten, Offset, …) historically **baked once** into
`subpaths` (`model/pathOps.ts`, one-shot commands). They are now also available as
**non-destructive, re-editable modifiers** — a Blender-style modifier stack —
so a tolerance (or offset distance, etc.) can be tuned at any time with a live
preview, and removed or reordered without losing the original geometry.

The repo already has the right precedent: **`effects`**
(`BaseNode.effects?: Effect[]`) is an ordered, non-destructive stack evaluated
downstream. Modifiers are the **geometry** counterpart of effects:

| | `effects` (shipped) | `modifiers` (this plan) |
| --- | --- | --- |
| transforms | appearance (blur, shadow) | **geometry** (`subpaths`) |
| evaluated in | render + SVG export only | render + hit-test + bounds + snap + SVG export |
| bounds impact | inflate by a margin | geometry actually changes |

Relation to **generators**: today `generator` is a *source-less, single-stage*
producer (`args → subpaths`). A modifier is *input-taking and stackable*
(`subpaths + args → subpaths`). Unify them as stages of one pipeline:

```
stage 0 (source):   hand-drawn subpaths   OR   a generator (args → subpaths)
stage 1..n:         modifier[i] (prev subpaths + params → subpaths)
result:             resolvedSubpaths(node)  — cached; used by all readers below
```

## Decision (data model)

Add an ordered modifier stack to path nodes, mirroring `effects`:

```ts
interface ModifiableShapeBase extends BaseShape {
  modifiers?: Modifier[];         // absent ⇒ resolved === the shape's own geometry
}
// rect, ellipse, line and path all extend it — their union is PrimitiveShape.
interface PathShape extends ModifiableShapeBase {
  type: "path";
  subpaths: PathSubpath[];        // BASE (editable) geometry — unchanged meaning
  fillRule: "nonzero" | "evenodd";
}

type Modifier =
  | { type: "simplify"; tolerance: number }
  | { type: "flatten"; tolerance: number }
  | { type: "offset"; distance: number; join: "miter" | "round" | "bevel" }
  | { type: "outline"; width: number; cap: "butt" | "round" | "square";
      join: "miter" | "round" | "bevel" }
  | { type: "smooth" }
  | { type: "reverse" };
// each modifier optionally: { enabled?: boolean } to toggle without removing
```

- A shape's own fields stay the **base** geometry — a path's `subpaths` (what
  the node tool edits), a rect's `x/y/width/height/cornerRadius`, a line's
  endpoints. They are *never* overwritten by a modifier, so a rect keeps its
  corner-radius field while an Offset stage reshapes what is painted.
- `baseSubpaths(shape)` is that base as contours (a rect becomes its rounded
  contour), and `resolvedSubpaths(shape)` applies the enabled stack over it.
  The resolved geometry is what every downstream reader consumes. Cached
  (see below).
- Readers do not call these directly any more: `model/path/shapeGeometry.ts`
  wraps them (together with brush envelopes and compound components) as the
  single geometry derivation the whole editor reads — see
  [architecture.md](architecture.md#shape-geometry-one-derivation). The few
  readers that keep an analytic or output-form fast path (`ctx.rect`, `<rect>`,
  exact rounded-rect containment) guard it with `hasActiveModifiers(shape)`, so
  a bare rect stays cheap and a modified one takes the generic contour route.
- `modifiedSubpaths(node)` is the older form of that guard — the resolved
  geometry when a stage is active on a non-path shape, `null` otherwise. It is
  still exported, but new code should reach for `shapeSubpaths` instead.
- Generators stay as the `generator` link producing stage-0 `subpaths`; a node
  can have *both* a generator and modifiers (generate → modify).

Deliberately **not** part of this: modifiers on `brush`/`text`/`image`/
`compoundPath` (a brush's width lives in its envelope, text needs glyph
outlines), boolean-as-modifier (needs a second operand — harder; deferred),
per-fill/stroke modifiers.

## Evaluation & caching

`resolvedSubpaths(node)` is a pure function of `(subpaths, modifiers)`. Because
the same result feeds render, hit-test, bounds, snap and export within a frame,
recomputing per call is wasteful. Options, cheapest first:

1. **Memo keyed on identity** — caches `{ subpaths, modifiers } → resolved` in a
   `WeakMap`-ish per-node cache invalidated by the node object identity (edits
   are immutable, so a new node object ⇒ recompute). Simplest; matches the
   immutable-doc model. **Implemented for v1.**
2. Store a derived `_resolved` alongside on transact (denormalized) — faster but
   risks drift; rejected.

Modifier ops reuse the existing paper.js / clipper machinery already used by
`model/pathOps.ts` (simplify/smooth/flatten) and `model/outlineStroke.ts`
(clipper offset). No new geometry engine.

## Read-site impact (the real cost)

Every current reader of `.subpaths` must be classified as **base** or
**resolved**. This is the blast radius (files found via `grep -rl '\.subpaths'`):

**Must switch to `resolvedSubpaths(node)`:**
- `canvas/render/scene.ts` — fill/stroke the resolved outline
- `canvas/overlay.ts` — selection bounds/handles (follow resolved geometry)
- `io/exportSvg.ts` — emit resolved path data
- `model/hitTest.ts` — pick against resolved outline
- `model/path.ts` (bounds/geometry helpers, used by `model/bounds.ts`) —
  bounds from resolved geometry
- `model/stroke.ts` — stroke the resolved outline
- `model/boolean.ts`, `model/bucketFill.ts`, `model/clippingMask.ts`,
  `model/outlineStroke.ts` — operate on resolved ink/silhouette
- `model/convertToPath.ts` — "Apply modifiers / Convert" bakes resolved

Those readers no longer branch per shape type at all: they call
`shapeSubpaths`/`shapePolylines`/`shapeRings`, which resolve the stack for
them. Only the four fast paths listed in
[architecture.md](architecture.md#shape-geometry-one-derivation) still branch,
each guarded by `hasActiveModifiers`. That guard is a convention the type
system cannot enforce, so `tests/modifierReaders.test.mjs` holds it up from two
sides:

1. every `src/` file branching on `rect`/`ellipse`/`line` must either consult
   resolved geometry or be listed as a base-geometry author (`NON_READERS`,
   with the reason) — a new reader that forgets the guard fails the build;
2. a modified primitive must be **indistinguishable from the path carrying the
   same base contours and the same stack** — bounds, hit testing (sampled
   grid), stroke outlining, arealness, stroke alignment and SVG geometry are
   compared pairwise across the primitives and several stacks. A fully
   disabled stack must conversely still emit `<rect>`/`<ellipse>`/`<line>`.

**Stay on base geometry (editable/source):**
- `canvas/nodes.ts` (node tool), `canvas/tools/penTool.ts`,
  `canvas/tools/shapeTools.ts`, `store/shapeSlice.ts` — create/edit base anchors
- `io/serialize.ts` — persist base + `modifiers` (not the resolved cache)
- `script/runScript.ts`, `model/generatorClient.ts` — scripting/source stage

The base/resolved split is exactly Illustrator's "edit the path, effects live on
top" model, and mirrors how `effects` already leaves `subpaths` untouched.

## UI

- **Modifiers panel section** in the properties panel, styled like the Effects
  section (`ui/panels/properties/…`): list with add / reorder / remove / enable
  toggle, per-modifier param fields. Editing a param is a transient preview
  (drag) → one transact on release, reusing the `clearTransient` pattern the
  drag-based edits already use, so tolerance is confirmed live.
- **Add a modifier** via the registry commands already added
  (`path.simplify`, …) — but as an "add modifier" variant (group "Path"),
  surfaced in the selection context menu + command palette. The existing
  one-shot `pathOpSelected` commands remain as **Apply once (bake)**.
- **Apply** (mirroring the generator's "Detach") bakes
  the resolved geometry into `subpaths` and clears `modifiers`
  (`convertToPath`-style); *Remove* drops a single modifier. A rect/ellipse/
  line cannot express an offset or outlined silhouette, so applying a stack on
  one converts the node to a `path` (`applyShapeModifiers`). Bindings onto the
  baked stages are dropped with them.

## Export & serialization

- **SVG/PNG**: emit resolved geometry (modifiers are baked at export time; no
  SVG modifier concept, unlike effects' `<filter>`). Export bounds already use
  resolved geometry once render does.
- **File format**: additive `modifiers?` field; absent ⇒ unchanged. Vinegar
  persists base geometry plus the modifier stack, not a duplicate resolved
  cache. Current builds also accept compatible v30 files.

## Decisions and deferred work

- Offset of open paths is a two-sided closed outline in v1. The sign is ignored
  for open contours; signed inward/outward offsets remain meaningful for closed
  contours. One-sided offset is deferred.
- Boolean-as-modifier (needs a second operand reference) — deferred.
- Modifiers on non-path shapes (auto-convert-on-add?) — deferred.
- Interaction with `brush` width profile and `compoundPath` children — still
  out of scope; a compound container consumes each child's resolved geometry.
- Resizing a modified shape scales its base geometry only: a modifier's
  distances are absolute local units and stay put, exactly as for paths.
- Caching strategy under heavy documents (ties into
  [render-performance.md](render-performance.md) culling/caching work).

## Implemented scope

- Modifiers apply to `rect`, `ellipse`, `line` and `path` — the shapes with
  resolvable outline geometry (`PrimitiveShape`). The stack is additive on all
  four; the primitive keeps its own editable fields.
- `resolvedSubpaths()` with identity-based memoization routes rendering,
  hit-testing, bounds, snapping, geometry operations, clipping, and export.
- Simplify, Flatten, Smooth, Reverse, Offset, and Outline are stackable and
  toggleable. Outline turns closed contours into centered bands and open
  contours into filled strokes with configurable width, cap, and join.
- The Properties panel supports live parameter preview, reorder, remove,
  enable/disable, and Apply; scrubbing commits as one undo step.
- Registry commands expose modifier addition and Apply in the command palette
  and selection context menu. Existing cleanup commands remain bake-once.

## Sequencing vs. roadmap

v21 path-unification and v22 compound-path nodes are both **done**. Path
modifiers operate on every primitive leaf; compound containers consume each
child's resolved geometry through the shared readers.
