# Parameters and references

Status: **shipped** (2026-08-03, file version **v32**) — document parameters
driving node fields, described here as built. The later steps toward a full
dependency graph are deliberately not designed yet; only their direction is
recorded, at the end. Related:
[path-modifiers.md](path-modifiers.md) (the stage pipeline this feeds),
[global-colors.md](global-colors.md) (the existing reference edge this copies),
[document-model.md](../document-model.md).

## Problem / motivation

Colours can already be *references*: a `swatch` paint points at
`doc.swatches[id]`, and editing the swatch re-tints every use live
(`resolvePaintRef`, [global-colors.md](global-colors.md)). Numbers cannot. Every numeric
parameter in the document is a literal:

- `GeneratorRef.args: Record<string, number>`
- `Modifier` params (`tolerance`, `distance`, `width`, …)
- `strokeWidth` and the rest of the appearance numbers

So "make every corner radius in this drawing 4 px larger" is a per-node edit,
while the same change to a colour is one edit. This note is about closing that
asymmetry — **not** about building a node-graph editor (see *Non-goals*).

The end state is a small dependency graph over the document: parameters are
sources, node fields are sinks, and a few edges run node → node. Only the first
step of that — document parameters driving node fields — is built; stopping
here is a valid outcome.

## Non-goals

- **No node-graph canvas.** Bindings are authored in the existing property
  fields and a Parameters panel section. A graph view, if it ever exists, is a
  read-only inspector ("what uses this / what does this depend on"), never the
  authoring surface. A second authoring surface would fight the direct
  manipulation the rest of the editor is built on.
- **No expression language.** If one is ever reached it reuses the generator
  script runtime (`model/generators/`), not a bespoke parser.
- Animation, constraints/solvers, and responsive auto-layout are out of scope.
  They may consume parameters later; they do not motivate this design.

## Document parameters

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
mechanical signature change deferred with the node→node work, pulled forward
and multiplied by three sinks.

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
  evaluate an expression layer rather than grow this record.
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

**Sinks** (kept deliberately small):

- `GeneratorRef.args` — built-in generators only (below)
- `PathModifier` numeric params (`tolerance`, `distance`, `width`)
- `strokeWidth`

Not sinks: position/size/rotation. Geometry lives in `subpaths` and
`transform`, so binding it is a different (and much larger) problem — it needs
the whole transform pipeline to become parameter-aware, and it is not planned.

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

## Where this was heading

Three further steps were sketched in full and then removed: they should not be
designed before what shipped has real use. The shape of the intent, so it is not
re-derived from scratch:

- **Parametric symbols** — a definition gains a parameter schema (reusing the
  generator schema verbatim) and an instance binds values into it, giving
  per-instance variation without an arbitrary override map. See
  [symbols.md](symbols.md). The scope chain (instance args ⊕ definition defaults
  ⊕ document parameters) belongs in `syncParamBindings`, not in a
  `resolveNum(v, scope)` signature.
- **Node-to-node edges** — a non-destructive boolean whose operands are other
  nodes, i.e. the first edge that is not parameter → field.
- **Expressions** — a small formula language over parameters. Optional, and
  explicitly last.

Two warnings that came out of the shipped work and still apply:

- **`scale` creep.** The moment `offset`, `min`, or a second operand is wanted in
  the ref record, stop and design the expression layer instead of extending it.
- **A cycle reaching `transact` is a silent no-op today.** Any node→node edge
  needs a real error surface first.

The full sketch is in the git history of this file. Roadmap position:
[../../TODO.md](../../TODO.md).
