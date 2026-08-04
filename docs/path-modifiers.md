# Path modifiers

Status: **implemented** (2026-08-02); the repeating **array** and **radial**
stages landed 2026-08-04 in **v36** (see *The repeating stages*).
File version: **v31** (additive shape
field, but Vinegar's strict current-only file policy requires a version bump;
absent `modifiers` still means no change). The **boolean** stage — the one
deferred below for needing a second operand — landed in **v35** as phase 3 of
[parameters.md](parameters.md); see *The boolean stage* at the end. Related: extends the generator concept
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
interface PathShape extends BaseShape {
  type: "path";
  subpaths: PathSubpath[];        // BASE (editable) geometry — unchanged meaning
  fillRule?: "nonzero" | "evenodd";
  modifiers?: Modifier[];         // NEW — absent ⇒ resolved === subpaths
}

type Modifier =
  | { type: "simplify"; tolerance: number }
  | { type: "flatten"; tolerance: number }
  | { type: "offset"; distance: number; join: "miter" | "round" | "bevel" }
  | { type: "outline"; width: number; cap: "butt" | "round" | "square";
      join: "miter" | "round" | "bevel" }
  | { type: "smooth" }
  | { type: "reverse" }
  // v35, see below
  | { type: "boolean"; op: BoolOp; operandId: string }
  // v36, see below
  | { type: "array"; count: number; dx: number; dy: number }
  | { type: "radial"; count: number; angle: number; cx: number; cy: number;
      rotateCopies: boolean };
// each modifier optionally: { enabled?: boolean } to toggle without removing
```

- `subpaths` stays the **base** geometry — what the node tool edits and what
  serializes. It is *never* overwritten by a modifier.
- `resolvedSubpaths(node)` applies the enabled stack over the base and is the
  geometry every downstream reader consumes. Cached (see below).
- Generators stay as the `generator` link producing stage-0 `subpaths`; a node
  can have *both* a generator and modifiers (generate → modify).

Deliberately **not** part of v1: modifiers on `rect`/`ellipse`/`brush`/`text`
(they'd first convert to path), boolean-as-modifier (needs a second operand —
harder; deferred, and shipped later in v35), per-fill/stroke modifiers.

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

**Stay on base `subpaths` (editable/source):**
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
  (`convertToPath`-style); *Remove* drops a single modifier.

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
- ~~Boolean-as-modifier (needs a second operand reference) — deferred.~~
  Shipped in v35; see *The boolean stage*.
- Modifiers on non-path shapes (auto-convert-on-add?) — deferred.
- Interaction with `brush` width profile and `compoundPath` children — v1 scopes
  to plain `path` nodes only.
- Caching strategy under heavy documents (ties into
  [render-performance.md](render-performance.md) culling/caching work).

## Implemented scope

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
modifiers operate on plain path leaves; compound containers consume each
child's resolved geometry through the shared readers.

## The boolean stage (v35)

`{ type: "boolean"; op: "union" | "subtract" | "intersect" | "xor"; operandId }`
combines the stage's input with **another scene node's** geometry, live. It is
phase 3 of [parameters.md](parameters.md) — the first edge in the document that
runs node → node — and it is Illustrator's compound shape minus the modal
shape-builder: the operand stays an ordinary node, so it remains selectable,
movable and editable, and the result re-resolves as it moves.

**What it cost, and why it was its own commit.** `resolvedSubpaths(shape)`
became `resolvedSubpaths(shape, doc?)`: a stage that reads another node is no
longer a pure function of the node. Every reader on the render / hit-test /
bounds / export path threads the document it already had, including the
predicates layered on top (`effectiveStrokeAlignment`, `strokeOutset`,
`isAreal`, `isCompoundChild`, `flattenPath`, …). A caller with no document in
hand degrades to skipping the stage — the un-combined geometry, never an empty
shape.

**Caching.** The identity memo could no longer key on the node alone: *moving
the operand leaves the target node object untouched*. `resolvedSubpaths` now
stores the operand nodes it read alongside the result and revalidates them by
identity — the same shape as the compound-path component check in
`render/path.ts`, which the Path2D cache also grew for the same reason. Both
degenerate to a null/empty dependency list for documents that use no boolean
stage, so nothing else pays for it.

**Cycles.** Operand edges must form a DAG. `hasAcyclicModifierOperands`
(`sceneValidation.ts`) is part of what `transact` requires and what the parser
rejects; the graph includes a compound path's components, since its outline
reads them the same way. Because a rejected transaction is a *silent* no-op,
`setModifierOperand` checks `wouldCycleThroughOperand` first and reports the
refusal — that is where the user is. The evaluator additionally guards with a
visiting set, so a hand-written cyclic file is an odd picture rather than a
frozen tab.

**Scope.** A symbol definition's content has no single world placement — each
instance places it differently — so an operand on the other side of a symbol
boundary has no well-defined offset from its consumer. Operands must share the
enclosing symbol (or both be outside one); a cross-boundary reference disables
the stage with that as its reason, and the picker refuses to create one.

**Copying** a combined pair rewires the copy to *its* copy (`remapPayload`
remaps `operandId` when the operand travelled in the same payload). An operand
left behind keeps its id, which still resolves in the same document and dangles
across documents — the documented degradation.

**A missing operand disables the stage** and the panel row says why
(`booleanOperandError`), matching how `enabled: false` already reads. There is
no `last` to fall back on: geometry is too big to duplicate onto every consumer.

**UI.** The modifier row has an operation select, the operand's name, and a
target button that arms canvas picking — the next click anywhere picks the
operand (Escape cancels), which is why `toolDispatch` intercepts before the
active tool. The usual entry point is *Combine (live)* (`path.combineLive`):
with a multi-selection it converts the bottom-most shape to a path if needed,
appends one boolean stage per other shape, and hides those operands. *Apply
modifiers* bakes the result, and the destructive Pathfinder commands
(`path.union`, …) are unchanged.

## The repeating stages (v36)

`array` and `radial` emit several copies of the stage's input as additional
contours: `count` copies in all, the first being the input itself, each further
one carried by a transform. They are the answer to "arrange this badge in a
ring" — the thing that previously meant placing six nodes by hand — and they are
the first stages that make [parameters.md](parameters.md)'s bindings visibly
worth having: `count`, the step and the sweep are all ordinary numeric modifier
params, so a document variable can drive the count of every repeated element at
once.

**Two stages, not one stage with a mode.** Their parameters do not overlap at
all, so a single record would carry four fields that are meaningless in half its
states, and every row would open with a mode select before saying anything.

- **`array`** repeats along a straight line: copy *i* is translated by
  `(dx·i, dy·i)`.
- **`radial`** repeats around `(cx, cy)` — the shape's *own* coordinate space,
  the one `subpaths` lives in, so the pivot is unaffected by the node's
  transform. `angle` is the **total sweep**, divided by the count, so the
  default full turn keeps redividing itself as the count changes; that is the
  case the stage exists for, and it is why the parameter is not a per-copy step
  the user would have to compute. With `rotateCopies` off, a copy is carried to
  where the turn puts its centre and left facing the way the original does
  (labels and glyphs in a ring), which is a translation, not the turn itself.

**Defaults are computed from the shape** (`DEFAULT_PATH_MODIFIER` now takes the
`PathShape`), so a freshly added stage *shows a repetition immediately* — a row
a shape-width apart, a ring around a pivot below the shape — instead of stacking
every copy on the original and looking inert.

**A count is a number like any other, which is the one real hazard.** It can be
bound to a document variable, and a variable knows nothing about the field it
drives, so `arrayCopyCount` makes it whole and bounds it at `MAX_ARRAY_COPIES`
(500) at every write and again in the evaluator. Without that, one scrub of a
bound count is an unbounded number of contours — the same reasoning as any other
domain clamp in `writeNumField`, but with a cost that grows the document's
geometry rather than just being wrong.

Nothing downstream needed changing: the output is subpaths, and every reader
already consumes a multi-contour resolved array. `count: 1` returns the input
array itself, so a stage that repeats nothing costs nothing and keeps the
identity the caches below key on.

**Deferred.** Per-copy accumulating transforms (step scale / step rotate, so
copies spiral or taper) are not in v36: the more a repeating stage can express,
the less the difference between it and simply baking copies, and no use has
asked for it yet. There is also no canvas handle for the radial pivot — the
centre is scrubbed in the panel — which is the first thing to add if the stage
gets used in anger.
