# Parameters and references

Status: **proposal** (2026-08-02). Not implemented. Related:
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

## Phase 1 — document parameters

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
invariant (checked in `sceneValidation.ts`).

A bindable number replaces a bare `number` at the sinks listed below:

```ts
export type NumValue =
  | number
  | {
      type: "param";
      paramId: string;
      /** Per-use multiplier, 1 = as stored. */
      scale: number;
      /** Last resolved value; used when the reference dangles. */
      last: number;
    };
```

Two deliberate choices:

- **`scale`** is precedented by `SwatchRefPaint.alpha` — a per-use modulation of
  a shared value, which covers "half the margin" / "double the stroke" without
  an expression language. An additive `offset` is deferred; if both are wanted,
  that is the signal to go to phase 4 instead of growing this record.
- **`last`** exists because a dangling numeric reference has no neutral value. A
  dangling swatch resolves to *no paint* (`resolvePaintRef` returns `null`) and
  that is a sensible picture; "no stroke width" is not. Storing the last
  resolved value means deleting a parameter, or pasting a node into a document
  that lacks it, degrades to the literal it was showing — the drawing never
  changes appearance behind the user's back. The UI surfaces the dangling state
  (below) rather than the model hiding it.

Resolution is a pure helper next to the model:

```ts
// model/params.ts
export function resolveNum(v: NumValue, params: Record<string, DocParam>): number;
export function paramUsageCounts(doc: Document): Map<string, number>;
export function bakeParamRefs(doc: Document, opts?: { paramId?: string; nodeIds?: Iterable<string> }): Document;
```

`paramUsageCounts` / `bakeParamRefs` mirror `swatchUsageCount(s)` and the
baking helper in `model/swatches.ts`; the panel and the "unbind" command need
exactly those two shapes.

**Sinks in phase 1** (kept deliberately small):

- `GeneratorRef.args` — `Record<string, NumValue>`
- `Modifier` numeric params
- `strokeWidth`

Not in phase 1: position/size/rotation. Geometry lives in `subpaths` and
`transform`, so binding it is a different (and much larger) problem — it needs
the whole transform pipeline to become parameter-aware. Deferred to phase 4 or
never.

File version: **v32** (additive `params`/`paramOrder`, plus the widened field
types; absent ⇒ no parameters, and a bare `number` stays legal everywhere).

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

File version: **v33**.

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

File version: **v34**.

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

- `resolveNum` is trivially cheap; no caching in phases 1–2. The expensive part
  is *downstream*: a parameter feeding a generator arg or a modifier param
  invalidates that node's resolved geometry, which the existing identity-based
  memo in `resolvedSubpaths` already handles — the node object changes, so the
  cache misses. No new invalidation mechanism.
- **A parameter edit touches many nodes at once.** Scrubbing a parameter that
  20 nodes bind is 20 node rewrites per frame plus 20 generator rebuilds.
  Parameter scrubbing must therefore use the interaction pattern
  (`beginInteraction` → `applyShapes` → `endInteraction`), not per-frame
  `transact` with a `coalesceKey` — the same reason slider drags on shapes do.
  Generator rebuilds are already async through the worker client; the panel must
  tolerate in-flight results arriving out of order during a drag.
- If profiling shows parameter scrubs are the worst case in large documents, the
  fix is a `paramId → nodeIds` reverse index built on demand (cached per
  document revision), not eager denormalization onto nodes.

## Read-site impact

Phase 1 is narrow because the sinks were chosen to be narrow. Every site that
reads one of the three widened fields must go through `resolveNum`:

- `canvas/render/style.ts` and `model/stroke.ts` — `strokeWidth`
- `model/generators/generatorClient.ts` — args before dispatching to the worker
- the modifier evaluation in the resolved-geometry path
- `io/exportSvg.ts` and the raster export — resolved numbers, never refs
- `store/*Slice.ts` write paths — writing a literal into a bound field must
  either unbind or edit the parameter; see UI below

The base/resolved split is the same discipline as modifiers: **the model stores
the reference, every consumer reads the resolved number**, and nothing
denormalizes the resolution back onto the node.

## UI

- **Parameters section** in a panel, modeled on the Swatches panel: name, value
  scrubber, usage count, add/rename/delete, delete offering "bake into uses".
- **Binding a field**: the numeric field gets a bind affordance (context menu
  *Bind to parameter…* plus a link glyph shown when bound). A bound field shows
  the parameter name and resolved value, and scrubbing it edits **the
  parameter** — with a clear affordance to unbind first when the user meant to
  change only this node. Getting this wrong (silently unbinding on drag) is the
  single most likely usability failure in phase 1.
- **Picking a reference** (phase 3): a target button on the modifier row, then
  click the operand on canvas — the eyedropper interaction, reused.
- **Dangling refs** render the `last` value with a warning chip offering *Unbind
  (keep value)* or *Recreate parameter*.
- Commands go in `commands/registry.ts` as usual: `param.create`,
  `param.bindSelection`, `param.unbindSelection`, `param.bakeAll`.

## Export & serialization

- **SVG/PNG**: parameters are resolved and baked at export; there is no SVG
  concept to map them onto (unlike effects → `<filter>`).
- **File format**: parameters and refs persist as authored; the resolved values
  are never written. Each phase bumps `CURRENT_FILE_VERSION` per the
  no-migration-chain policy in `io/serialize.ts`, and updates
  `docs/document-model.md`.
- **Clipboard**: copying a bound node must carry the referenced `DocParam`s in
  the payload and merge them on paste (name-collision → reuse the existing
  parameter if value and name match, else rename). Without the merge, `last`
  keeps the picture correct but the binding is lost — the same failure the
  generator `scriptId` had (TODO.md, system clipboard).
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

Phase 1 is independent of everything currently in flight. Phases 2 and 3 both
depend on phase 1's `NumValue` and on work already shipped (symbols v1, path
modifiers v31). None of this should precede the 1.0 release gates in TODO.md
(SVG import, clipboard, save workflow, export fidelity).
