# Parameters and references

Status: **phase 1 implemented** (2026-08-03); phases 2–4 remain a proposal.
Related:
[path-modifiers.md](path-modifiers.md) (the stage pipeline this feeds),
[global-colors.md](global-colors.md) (the existing reference edge this copies),
[document-model.md](document-model.md).

## Problem / motivation

Colours can already be *references*: a `swatch` paint points at
`doc.swatches[id]`, and editing the swatch re-tints every use live
(`resolvePaintRef`, docs/global-colors.md). Numbers cannot. Every numeric
parameter in the document is a literal:

- `GeneratorRef.args: Record<string, number>`
- `Modifier` params (`tolerance`, `distance`, `width`, …)
- `strokeWidth` and the rest of the appearance numbers

So "make every corner radius in this drawing 4 px larger" is a per-node edit,
while the same change to a colour is one edit. This note is about closing that
asymmetry — **not** about building a node-graph editor (see *Non-goals*).

The end state is a small dependency graph over the document: parameters are
sources, node fields are sinks, and a few edges run node → node. It is
introduced in four phases, each independently shippable, each useful on its own.
Phases 3 and 4 are explicitly optional; stopping after phase 2 is a valid
outcome.

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

Symbol definitions gain a parameter schema, instances bind values into it:

```ts
interface SymbolDef {
  // …
  params: GeneratorParam[];   // reuse the generator schema verbatim
}

interface SymbolInstance extends BaseNode {
  // …
  args: Record<string, NumValue>;
}
```

Reusing `GeneratorParam` (`model/generators/generators.ts`) is the point: the
label/min/max/step/integer schema, its editor UI, and its scrubbing behaviour
already exist, and a symbol's parameter row should be indistinguishable from a
generator's.

**Scoping rule** (the load-bearing decision): a `param` reference inside a
symbol definition resolves against, in order,

1. the args of the instance currently being evaluated,
2. the definition's own parameter defaults,
3. the document parameters.

So the same definition renders differently per instance, while a definition that
references a document parameter (say a global stroke width) still tracks it.
Evaluation therefore carries a **scope**, not just `doc.params`:

```ts
resolveNum(v, scope)   // scope = instance args ⊕ definition defaults ⊕ doc.params
```

Nested instances stack scopes; the innermost instance wins. Depth is already
bounded by the existing no-recursive-symbols check.

This is the roadmap's symbol v2 (parametrization), and it is where the feature
starts paying for itself for icon/UI-kit style documents.

File version: **v34**.

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

**None.** That is the point of keeping the reference beside the field rather
than in it: bound fields stay plain numbers, so rendering, hit-testing, bounds,
brush width, path modifiers and SVG/raster export were not touched at all. The
one discipline that replaces the base/resolved split is that **every path that
publishes a document re-resolves it** — `transact`, `endInteraction`, and
document load — so no consumer can ever observe a stale bound field.

Write paths do need care, and they get it in one place: writing a literal into a
bound field is not silently dropped, it is simply overwritten on the next commit
by the parameter that owns it. The UI never offers that write — see below.

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
  the link would be lost.
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

## Sequencing

Phase 1 shipped independently of everything else in flight. Phases 2 and 3 build
on phase 1's `ParamRef`/`bindings` and on work already shipped (symbols v1, path
modifiers v31). None of the remaining phases should precede the 1.0 release
gates in TODO.md (SVG import, clipboard, save workflow, export fidelity).

Phase 2 note: `SymbolInstance.args` was proposed as `Record<string, NumValue>`.
With bindings beside the field it becomes `Record<string, number>` plus the
instance's own `bindings` entries under `args.<key>`, and the scope chain
(instance args ⊕ definition defaults ⊕ document parameters) moves into
`syncParamBindings` rather than into a `resolveNum(v, scope)` signature.
