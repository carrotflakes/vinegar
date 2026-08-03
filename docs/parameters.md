# Parameters and references

Status: **phase 1 implemented** (2026-08-03); phases 2–4 remain a proposal.
Phase 2 was rewritten (2026-08-04) around typed document variables after global
colours widened to any concrete paint in v33 — see *Document variables* below.
Related:
[path-modifiers.md](path-modifiers.md) (the stage pipeline this feeds),
[global-colors.md](global-colors.md) (the existing reference edge this copies),
[document-model.md](document-model.md).

## Problem / motivation

Paint can already be a *reference*: a `swatch` fill points at
`doc.swatches[id]`, and editing that swatch — solid, gradient or pattern since
v33 — repaints every use live (`resolvePaintRef`, docs/global-colors.md).
Numbers cannot. Every numeric parameter in the document is a literal:

- `GeneratorRef.args: Record<string, number>`
- `Modifier` params (`tolerance`, `distance`, `width`, …)
- `strokeWidth` and the rest of the appearance numbers

So "make every corner radius in this drawing 4 px larger" is a per-node edit,
while the same change to a colour is one edit. This note is about closing that
asymmetry — **not** about building a node-graph editor (see *Non-goals*).

The end state is a small dependency graph over the document: parameters are
sources, node fields are sinks, and a few edges run node → node. It is
introduced in four phases, each independently shippable, each useful on its own.
Phases 3 and 4 are explicitly optional; so is phase 2b, and stopping after
phase 2a is a valid outcome.

## Non-goals

- **No node-graph canvas.** Bindings are authored in the existing property
  fields and a Parameters panel section. A graph view, if it ever exists, is a
  read-only inspector ("what uses this / what does this depend on"), never the
  authoring surface. A second authoring surface would fight the direct
  manipulation the rest of the editor is built on.
- **No new expression language** in phases 1–3. Phase 4, if reached, reuses the
  generator script runtime (`model/generators/`), not a bespoke parser.
- Animation, constraints/solvers, and responsive auto-layout are out of scope.
  They may consume parameters later; they do not motivate this design.

## Phase 1 — document parameters (implemented)

Named numbers on the document, mirroring swatches field-for-field:

```ts
export interface DocParam {
  id: string;
  name: string;
  value: number;
  /** UI hints for the scrubber; not enforced on bound values. */
  min: number | null;
  max: number | null;
  step: number | null;
  integer: boolean;
}

interface Document {
  // …
  params: Record<string, DocParam>;
  /** Panel display order. Every id here exists in `params` and vice versa. */
  paramOrder: string[];
}
```

`paramOrder` exists for the same reason `swatchOrder` does, and carries the same
invariant (`hasValidParams` in `model/params.ts`, enforced by the serializer).

### Bindings live beside the field, not in it

The original proposal widened each sink to a `NumValue` union — the reference
stored *in* the field, resolved on every read. That was rejected during
implementation for a concrete reason: the sinks are read by pure geometry
helpers that take a shape and nothing else (`resolvedSubpaths(shape)`,
`strokeOutset(shape)`, `brushEnvelope(shape)`, `hitTestShape`, `shapeStrokeMargin`,
…). Widening the field type forces the parameter scope into ~55 call sites
across the geometry, hit-testing, rendering and export layers — the same wide
mechanical signature change this note defers to phase 3, pulled forward into
phase 1 and multiplied by three sinks.

Instead the reference lives in a side table on the node, and the field itself
holds the last resolved number:

```ts
interface BaseNode {
  /** Bindable field path -> reference. Empty means the node binds nothing. */
  bindings: Record<string, ParamRef>;
}

interface ParamRef {
  paramId: string;
  /** Per-use multiplier, 1 = as stored. */
  scale: number;
}
```

Field paths are `"strokeWidth"`, `"generator.args.<key>"` and
`"modifiers.<index>.<key>"`.

What this buys and what it costs:

- **Every consumer keeps reading a plain `number`.** Not one geometry, render,
  hit-test or export signature changed. The whole feature is additive.
- **`last` is no longer a separate field** — the literal *is* the last resolved
  value, so the reasoning behind it holds unchanged: deleting a parameter, or
  pasting a node into a document that lacks it, degrades to the number it was
  showing. A dangling numeric reference has no neutral value the way a dangling
  swatch does (`resolvePaintRef` → `null` → no paint is a sensible picture; "no
  stroke width" is not), and the UI surfaces the dangling state rather than the
  model hiding it.
- **`scale`** is unchanged and still precedented by `SwatchRefPaint.alpha`. An
  additive `offset` is still deferred; wanting both is still the signal to
  evaluate phase 4 rather than grow this record.
- **The cost is denormalization**, which this note originally ruled out. It is
  contained by resolving at exactly one place: `syncParamBindings(doc)` runs
  inside `transact`, inside `endInteraction`, and on document load. No slice has
  to remember to re-resolve, and there is no code path that commits a document
  with a stale bound field. Bindings whose field path stops addressing anything
  — a removed modifier stage, a detached generator — are pruned in the same
  pass; bindings whose *parameter* is missing are kept, since the parameter may
  come back (undo, a later paste).
- **Index-keyed modifier paths** have to be re-keyed when the stack is reordered
  or a stage is removed, or a binding would follow the slot instead of the
  modifier it was attached to. `remapModifierBindings` does this and
  `setPathModifiers` takes the result; `ModifiersSection` is the only caller
  that needs it.

Resolution and the panel's needs are pure helpers next to the model:

```ts
// model/params.ts
export function syncParamBindings(doc: Document): Document;
export function paramUsageCounts(doc: Document): Map<string, number>;
export function bakeParamRefs(doc, opts?: { paramId?; nodeIds?; path? }): Record<string, SceneNode>;
```

`paramUsageCounts` / `bakeParamRefs` mirror `swatchUsageCount(s)` and the baking
helper in `model/swatches.ts`; the panel and the "unbind" commands need exactly
those two shapes.

**Sinks in phase 1** (kept deliberately small):

- `GeneratorRef.args` — built-in generators only (below)
- `PathModifier` numeric params (`tolerance`, `distance`, `width`)
- `strokeWidth`

Not in phase 1: position/size/rotation. Geometry lives in `subpaths` and
`transform`, so binding it is a different (and much larger) problem — it needs
the whole transform pipeline to become parameter-aware. Deferred to phase 4 or
never.

**Document-script generators are not bindable.** A bound generator arg has to
retune its geometry in the same document commit, and `syncParamBindings` is a
pure `Document → Document` step: it can call a built-in's `build` synchronously,
but a document script's geometry only comes back from the worker. Binding one
would let its args and its geometry drift apart, so the bind button is disabled
on script generators with that reason as its tooltip. Lifting this needs the
async commit path `setGeneratorArgs` already has, wired into parameter edits —
worth doing when someone actually wants it.

File version: **v32**. Additive: `params`/`paramOrder` on the document and
`bindings` on every node. v31 files still open — the parser fills the three
fields with their empty values, the same "no parameters" state a new document
has.

## Phase 2 — parametric symbols

The roadmap's symbol v2, and where the feature starts paying for itself in
icon/UI-kit documents. Two things have to be settled before any schema: **what a
parameter can be** (numbers only, or paint too), and **how a per-instance value
reaches a subtree that every instance shares**. The second is where the cost is,
and it splits this phase in two.

### Document variables: one table, two mechanisms

Phase 1 built `DocParam` as a deliberate mirror of `Swatch` — the same
id/name/order shape and bijection invariant, the same usage-count and baking
helpers, and a `ParamRef.scale` explicitly precedented by `SwatchRefPaint.alpha`.
They are one concept ("a named value the document shares"), reached from two
directions. Phase 2 is where keeping them apart starts to cost something: a
symbol whose instances can override a number but not a colour has exactly the
arbitrary hole global colours had before v33, and the fix would be a second
schema, a second scope chain and a second panel.

So a symbol parameter — and a document one — is a **typed variable**:

```ts
type VarValue =
  | { kind: "number"; value: number;
      min: number | null; max: number | null; step: number | null; integer: boolean }
  | { kind: "paint"; value: ConcretePaint };

interface DocVar { id: string; name: string; value: VarValue }

// Document (replacing swatches/swatchOrder and params/paramOrder):
vars: Record<string, DocVar>;
varOrder: string[];
```

**The table merges; the reference edges stay split, and that is not a
compromise.** The two mechanisms exist because their sinks differ, and phase 1
already documented why (see *Bindings live beside the field, not in it*):

| | paint sink | number sink |
|---|---|---|
| Reference lives | **in** the field (`fill` is a `swatch` Paint) | **beside** the field (`node.bindings`, field holds the last resolved number) |
| Resolved | at paint time, `resolvePaintRef` | at commit time, `syncParamBindings` |
| Why | only three sites paint, and a dangling ref has a neutral value (`null` → no paint) | ~55 pure geometry helpers read these, and "no stroke width" is not a picture |

Forcing either mechanism onto the other type would undo one of those two
results. What merging the table buys is everything above the mechanism: one
panel, one set of commands, one clipboard reattach path, one delete-bakes-first
rule — and, the point of this phase, **one scope chain that covers both types**.

### Why per-instance overrides are not one feature

`SymbolInstance` holds a `symbolId` and nothing else. Rendering an instance
descends into `doc.symbols[symbolId].rootNodeId` in the *shared* `doc.nodes` map,
and so does everything else that reads through an instance — `paintNode`,
`instanceWorldBounds`, `symbolLeafIds`, `hitTestShape`, picking, bucket fill,
`exportSvg`. Two instances with different override values need two different
readings of the same nodes.

That collides head-on with phase 1's cost containment: a bound field holds its
**last resolved literal**, written once per commit. One node, one value. It
cannot express "8 here, 12 there".

How much the collision costs depends entirely on what is being overridden:

- **Paint does not feed geometry.** Bounds, hit-testing, picking, snapping and
  layout never read `fill`/`stroke`. Paint is already resolved *late*, at exactly
  the three sites that paint, and the two traversals that matter
  (`render/scene.ts`, `exportSvg.ts`) already carry a recursive descent through
  instances — `paintNode` threads an `activeSymbols` set through it today.
  Giving that descent a scope is a local change. The third site,
  `TextEditor.tsx`, resolves one node's fill while editing it, which happens in
  symbol-edit focus where the scope is just the definition's defaults.
- **Numbers feed geometry.** `strokeWidth`, generator args and modifier params
  all land in `resolvedSubpaths`/`strokeOutset`/`brushEnvelope`, read by pure
  helpers that take a node and nothing else. Per-instance numbers make those
  reads instance-aware — the wide signature change phase 1 exists to avoid.

Hence 2a and 2b, in that order. They share one schema; they do not share a cost.

### Phase 2a — paint overrides

The schema lands whole here:

```ts
interface SymbolParam {
  key: string;
  label: string;
  /** Default when an instance does not override it. Fixes the param's type. */
  default: VarValue;
}

interface SymbolDef {
  // …
  params: SymbolParam[];
}

interface SymbolInstance extends BaseNode {
  // …
  /** Per-instance overrides, keyed by SymbolParam.key. */
  args: Record<string, VarValue>;
}
```

`SymbolParam` is `GeneratorParam` (`model/generators/generators.ts`) with its
min/max/step/integer moved inside `VarValue`'s number arm, so a symbol's
parameter row can still be the generator row's editor and scrubber for the
numeric case. A **numeric symbol parameter is declarable but not yet honoured in
2a**: the evaluator ignores it and the UI disables the row with that as its
tooltip — the same discipline phase 1 used for document-script generators, and
for the same reason (shipping a link that silently does not update would be
worse than not offering it).

Resolution grows a scope where it already resolves:

```ts
resolvePaintRef(paint, doc.swatches)   // today
resolvePaint(paint, scope)             // 2a
```

**Scoping rule** (the load-bearing decision, unchanged from the original
proposal and now typed): a reference inside a symbol definition resolves against,
in order,

1. the args of the instance currently being evaluated,
2. the definition's own parameter defaults,
3. the document variables.

So the same definition paints differently per instance, while a definition that
references a document variable (a brand colour, say) still tracks it. Nested
instances stack scopes and the innermost wins; depth is already bounded by the
existing no-recursive-symbols check. Outside any instance the scope is just
`doc.vars`, which is what `resolvePaintRef` is today — so the change is additive
at every existing call site.

What this does *not* disturb:

- **Render caches.** `pathCache` is a `WeakMap` on shape identity holding a
  `Path2D` — geometry only, and geometry is what paint overrides do not touch.
  Effect layers come from a pool of blank canvases re-rendered every frame
  (`layers.ts`), not a content cache, so there are no baked pixels to invalidate
  per scope.
- **Everything that is not painting.** Bounds, picking, snapping, export
  geometry: untouched, because they never read paint.

File version: **v34** — the same bump carries the `swatches`+`params` → `vars`
merge, since both rewrite the document's top-level shape and there is no reason
to spend two versions on one idea. Unlike v33, this is not a pure widening:
v31–v33 need a real read-time transform (`swatches` entries become
`kind: "paint"` vars, `params` entries `kind: "number"`, `varOrder` the
concatenation, and `SwatchRefPaint.swatchId` is re-pointed at the var id). Ids
carry over unchanged, so the transform is total and lossless and those versions
can stay in `SUPPORTED_FILE_VERSIONS` — the same shape as the v31 backfill the
parser already does, one step up in size.

### Phase 2b — numeric overrides

The prerequisite is the one phase 3 already names: geometry resolution has to
move from "a literal baked at commit" to "derived from (node, context) and
memoized". Phase 3 states it for a single operand — `resolvedSubpaths(node)`
becoming `resolvedSubpaths(node, doc)` — and 2b is the same change with the
instance scope in the context.

**So 2b should not precede phase 3.** Alone it pays for the entire wide signature
change to buy a narrower feature; landed with (or after) phase 3, the signature
change is spent once. Sequenced that way, 2b is mostly the scope plumbing 2a
already built, extended to the numeric sinks:

- `syncParamBindings`'s commit-time write stays for bindings **outside** any
  symbol definition, where one node really does have one value.
- Inside a definition, a bound field's stored literal degrades to what it means
  everywhere else in this design: the last resolved value, correct for the
  definition's own defaults, and the value any reader that ignores scopes will
  show. The per-instance value comes from the memoized derived layer.

That split is the honest version of the cost, and it is worth stating plainly:
2b is the first place where a node's stored field is not, on its own, the truth.
Everything phase 1 avoided about that lands here, which is precisely why it is
last and why 2a is separable from it.

File version: **v35**, shared with phase 3 if they land together.

## Phase 3 — a node-to-node edge: non-destructive boolean

`docs/path-modifiers.md` defers boolean-as-modifier precisely because it "needs
a second operand reference". That is the first genuine node → node edge, and it
is worth doing *because it is a wanted feature*, not because it advances the
graph:

```ts
type Modifier =
  // …
  | { type: "boolean"; op: "unite" | "subtract" | "intersect" | "exclude"; operandId: string };
```

The operand stays a normal scene node (typically hidden), so it remains
selectable, movable and editable, and the result updates live — Illustrator's
compound shape, minus the modal shape-builder.

What this phase actually costs:

- **`resolvedSubpaths(node)` becomes `resolvedSubpaths(node, doc)`.** Today it
  is pure in the node alone and memoized on node identity. With an operand it
  must key on `(node identity, resolved operand)`; the memo entry is invalidated
  when either object identity changes. Every read site listed in
  path-modifiers.md's blast radius already has the document in hand, but this is
  a wide, mechanical signature change and should be its own commit.
- **Cycle detection.** `sceneValidation.ts` gains a check that operand edges
  form a DAG, so `transact` rejects a cycle the same way it rejects a malformed
  tree. Evaluation is depth-first with a visiting set; there is no separate
  scheduler.
- **Dangling operands.** Unlike parameters there is no `last` to fall back on
  (geometry is too big to duplicate). A missing operand disables the modifier
  and shows an error row, matching how `enabled: false` already reads.

File version: **v35**.

## Phase 4 — expressions (optional, decide later)

Only if phases 1–3 land and `scale` demonstrably is not enough:

```ts
| { type: "expr"; source: string; deps: string[]; last: number }
```

evaluated in the existing generator sandbox (`new Function` in the worker,
`model/generators/generatorWorker.ts`), with `deps` extracted at author time so
the dependency graph stays statically inspectable rather than discovered at
evaluation. This is what unlocks `= frame1.height * 0.618`, and it is the only
phase that requires exposing node measurements (bounds, path length, child
count) as readable values — a public surface that has to be designed with the
Script API, not separately.

Do not start here. The value curve is unfavourable until documents actually
contain parameters worth relating to each other.

## Evaluation & caching

- Resolving one reference is trivially cheap, and `syncParamBindings` skips any
  node with an empty `bindings` map in one property read, so the per-commit pass
  costs about what the validation pass beside it already costs. No caching.
- The expensive part is *downstream*: a parameter feeding a generator arg or a
  modifier param invalidates that node's resolved geometry, which the existing
  identity-based memo in `resolvedSubpaths` already handles — the node object
  changes, so the cache misses. No new invalidation mechanism.
- **A parameter edit touches many nodes at once.** Scrubbing a parameter that
  20 nodes bind is 20 node rewrites per frame plus 20 generator rebuilds. So
  parameter scrubbing uses the interaction pattern (`beginInteraction` →
  `setDoc` → `endInteraction`), not per-frame `transact` with a `coalesceKey` —
  the same reason slider drags on shapes do. Both the Parameters panel and a
  bound field in the properties panel go through it.
- If profiling shows parameter scrubs are the worst case in large documents, the
  fix is a `paramId → nodeIds` reverse index built on demand (cached per
  document revision).

## Read-site impact

**None in phase 1.** That is the point of keeping the reference beside the field rather
than in it: bound fields stay plain numbers, so rendering, hit-testing, bounds,
brush width, path modifiers and SVG/raster export were not touched at all. The
one discipline that replaces the base/resolved split is that **every path that
publishes a document re-resolves it** — `transact`, `endInteraction`, and
document load — so no consumer can ever observe a stale bound field.

Write paths do need care, and they get it in one place: writing a literal into a
bound field is not silently dropped, it is simply overwritten on the next commit
by the parameter that owns it. The UI never offers that write — see below.

Later phases spend this budget deliberately, and unevenly: phase 2a touches only
the two traversals that paint (a scope argument where `doc.swatches` is passed
today) and nothing that computes geometry; phase 2b and phase 3 are the ones
that make geometry reads context-aware, which is why they share a prerequisite
and why 2b is sequenced behind 3.

## UI

- **Parameters panel** (`ui/panels/params/ParamsPanel.tsx`), modeled on the
  Swatches panel: name, value scrubber, usage count, add/delete, delete
  detaching every binding first so nothing dangles and nothing moves.
- **Binding a field**: `ui/controls/BindableNumber.tsx` wraps `ScrubbableNumber`
  with a link button. Unbound, the menu offers *New parameter from this value*
  and the document's existing parameters. Bound, the field shows the resolved
  value and scrubbing it edits **the parameter** — every other field bound to it
  moves too — while the menu offers *Unbind (keep value)*. Binding never moves
  anything: `scale` defaults to whatever keeps the field's current value.
  Getting this wrong (silently unbinding on drag) was called out as the single
  most likely usability failure, and it is why scrubbing a bound field is
  deliberately *not* an unbind.
- Stroke width shows the affordance only for a single-node selection: binding is
  per node, and a multi-selection has no single field to bind.
- **Dangling refs** render the last value with a warning glyph offering *Unbind
  (keep value)*.
- **Picking a reference** (phase 3): a target button on the modifier row, then
  click the operand on canvas — the eyedropper interaction, reused.
- Commands in `commands/registry.ts`: `param.create`, `param.unbindSelection`,
  `param.bakeAll`.

Phase 2 adds two surfaces and merges one:

- **Document variables panel** — the Parameters and Global colors panels become
  sections of one panel once `vars` merges them (v34). The row is the same in
  both: name, value editor (scrubber or `ColorField`), usage count, delete that
  bakes first. Doing this as pure UI/vocabulary *before* v34 is the cheap step
  named in *Sequencing*.
- **Instance parameter rows** — selecting an instance shows its symbol's params
  in the properties panel, each row an override editor over the definition's
  default. The numeric rows are visible but disabled until 2b, with the reason
  in the tooltip. Overriding never moves anything; clearing a row falls back to
  the definition default rather than baking it in.
- **Defining a symbol parameter** — inside symbol-edit focus, a bound field's
  menu gains *Promote to symbol parameter*, which is the only authoring path
  that creates one. There is no separate schema editor: a symbol's parameter
  list is the set of promotions, in promotion order.

## Export & serialization

- **SVG/PNG**: parameters are resolved and baked at export; there is no SVG
  concept to map them onto (unlike effects → `<filter>`).
- **File format**: parameters and bindings persist as authored. The resolved
  value is written too, because it *is* the field — an older build, or any
  reader that ignores `bindings`, still sees a correct drawing. Each phase bumps
  `CURRENT_FILE_VERSION` per the no-migration-chain policy in `io/serialize.ts`,
  and updates `docs/document-model.md`.
- **Clipboard**: copying a bound node carries the referenced `DocParam`s in the
  payload and merges them on paste, so the binding survives a move between
  documents (`referencedParamIds` → `copyPayload` →
  `reattachPayloadResources`). Merging is by id, matching how scripts, assets
  and swatches already reattach: the destination's own definition wins. Without
  the merge the picture would still be right — the field keeps its number — but
  the link would be lost. Once `vars` merges the two tables (v34) this becomes
  one reattach path instead of the two that exist today.
- **Script API**: parameters should be readable and writable from scripts before
  phase 4, since "set a parameter, re-run" is the cheapest possible version of
  the parametric-generation wish in TODO.md.

## Risks

- **Nobody uses it past phase 1.** Likely, and acceptable — phase 1 stands alone
  as "swatches for numbers". The phase order exists so this outcome costs
  nothing already spent.
- **Bound-field editing semantics** (see UI) is where the feature is won or
  lost, not the model.
- **`scale` creep.** The moment `offset`, `min`, or a second operand is wanted
  in the ref record, stop and evaluate phase 4 instead of extending it.
- **Cycles reaching `transact`.** Mitigated by validation, but a rejected
  transaction is a silent no-op today; parameter/operand edits need an actual
  error surface, not a swallowed rejection.
- **The `vars` merge buys naming, not capability.** Done on its own it is a
  format bump for a rename. It is worth doing only as part of 2a, where the
  typed schema is load-bearing (a symbol parameter has to be able to be a
  colour); before that, do the panel/vocabulary version instead.
- **2a ships an authoring surface for a half-honoured schema.** Numeric symbol
  parameters are declarable and visibly disabled until 2b. That is deliberate —
  it is the same trade phase 1 made for script generators — but if 2b never
  lands, those disabled rows are permanent dead UI, and removing the numeric arm
  from `SymbolParam` is the right correction rather than leaving them.

## Sequencing

Phase 1 shipped independently of everything else in flight. The rest build on
phase 1's `ParamRef`/`bindings` and on work already shipped (symbols v1, global
colours v33, path modifiers v31). None of them should precede the 1.0 release
gates in TODO.md (SVG import, clipboard, save workflow, export fidelity).

The one hard ordering constraint inside the remainder is **2b after 3**: both
need geometry resolution to become context-aware and memoized, and doing 2b
first pays for that whole signature change to buy the narrower half of one
feature. Everything else is free order — 2a stands alone, 3 stands alone, and
stopping after 2a is a valid outcome.

A cheap step that needs none of this: unify the *panel and vocabulary* for
global colours and parameters ("document variables") while `swatches` and
`params` stay separate in the model. It gets most of the conceptual win with no
format change, and it makes the v34 merge a rename rather than a new idea.
