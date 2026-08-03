# Global colors (color variables) — design

Status: implemented (v1 in file format v23; widened to any concrete paint in
v33; **merged into the typed `vars` table in v34**, phase 2a of
[parameters.md](parameters.md)). The two open questions below were resolved per
their "leaning": one entry with `applyColorVar(id, target)` for fill vs. stroke,
and plain references first (no per-use tint UI yet — the `alpha` field exists on
`VarRefPaint` and resolves, but nothing authors it).

**Naming, as of v34.** A global colour is a *document variable whose value is a
paint* — `doc.vars[id].value = { kind: "paint", value: ConcretePaint }` — and a
fill/stroke references it with a `var` Paint (`varId` + per-use `alpha`). The
old `doc.swatches` / `swatchOrder` / `type: "swatch"` names are gone; files that
use them are transformed on read (ids carry over unchanged). Everything below
still describes the design; read `swatch` as "colour variable" in the historical
sections. The one behavioural change the merge brought is scope: inside a symbol
definition a `var` paint may name one of that symbol's *parameters*, which an
instance can override — see [parameters.md](parameters.md).

A **global color** is a named color stored on the document. Any number of nodes
reference it by id instead of holding their own color; editing the global color
once re-tints every referencing node live. Think "CSS variable for paint".

This is distinct from the existing personal **saved swatches** in
[`prefsSlice.ts`](../src/store/prefsSlice.ts) (see below).

## Decisions up front

- **Reference, don't copy.** A node's `fill`/`stroke` can be a new `swatch`
  Paint variant that only holds a `varId`. The concrete color lives once, in
  `doc.vars`. This is what makes "edit once, update everywhere" fall out for
  free — there is no propagation step; every consumer resolves the reference at
  paint time.
- **Resolve at the boundary, keep everything else ref-blind.** A single
  `resolvePaintRef(paint, swatches)` helper turns a possibly-referential Paint
  into a concrete one. Every place that actually *paints* (canvas render, SVG
  export, CSS previews) calls it first; nothing downstream needs to know
  references exist. This mirrors how the discriminated `Paint` union already
  isolates gradients/patterns (see the note atop [`paint.ts`](../src/model/paint.ts)).
- **Swatches store concrete paint only — no chains.** `Swatch.paint` is a
  solid/gradient/pattern, never itself a `swatch` ref. That removes cycle and
  multi-hop resolution concerns; validation enforces it.
- **A swatch holds any concrete paint** — solid, gradient or pattern
  (`ConcretePaint`). v1 shipped solid-only; v33 widened it, because the "edit
  once, update everywhere" promise was arbitrarily missing for exactly the paint
  most worth sharing across a document. Nothing downstream needed changing:
  `resolvePaintRef` already returned `ConcretePaint`, and every consumer already
  switched on the resolved paint's type.
  Still *not* supported, and still future work: a gradient **stop** or a
  pattern's own fields referencing a global (that needs reference resolution
  *inside* a paint, which would break the single-hop rule below).
- **Optional per-use tint.** A `swatch` reference may carry `alpha` (0..1) to
  tint that one usage on top of the swatch's own alpha, matching Illustrator's
  global-color tint. Absent = 1 (use as-is). Solid and pattern have one alpha to
  scale; a gradient's opacity lives per stop, so the tint scales every stop.
  A tint of exactly 1 returns the swatch's paint object untouched, so the
  common case allocates nothing per resolution.
- **Deleting a global color detaches, never silently breaks.** On delete, every
  reference is first resolved to a concrete paint (baked in place), then
  the swatch is removed. No dangling ids survive a delete.

### Global colors vs. the existing saved swatches

| | Saved swatches (today) | Global colors (this doc) |
|---|---|---|
| Stored in | user prefs ([`prefsSlice.ts`](../src/store/prefsSlice.ts)) | the document (`doc.vars`) |
| Scope | all documents (personal palette) | one document |
| Applying | copies the color into the node | links the node to the swatch |
| Editing later | no effect on past uses | re-tints every reference live |

They are complementary and both stay. To avoid UI confusion, the document ones
are labelled **"Global colors"** (never just "swatches"); the shipped panel and
the ColorField section both use that label.

## Data model

As shipped in v34, in [`paint.ts`](../src/model/paint.ts) and
[`vars.ts`](../src/model/vars.ts):

```ts
export interface VarRefPaint {
  type: "var";
  /** Id of a DocVar in doc.vars, or of a SymbolParam in the enclosing scope. */
  varId: string;
  /** Per-use tint 0..1, multiplied onto the variable's own alpha. */
  alpha: number;
}

export type Paint = SolidPaint | GradientPaint | PatternPaint | VarRefPaint;
export function varRef(varId: string, alpha?: number): VarRefPaint;

/** Resolve a possibly-referential paint to a concrete one, against a lookup
 *  chain. Returns null for a dangling reference (or one that names a number)
 *  so callers can fall back (render: skip; export: omit). */
export function resolvePaint(
  paint: Paint | null,
  scope: VarScope | null
): ConcretePaint | null;
```

and in [`types.ts`](../src/model/types.ts) `Document`:

```ts
export interface DocVar { id: string; name: string; value: VarValue }

// Document:
vars: Record<string, DocVar>;
/** Panel display order. Every id here exists in `vars` and vice versa. */
varOrder: string[];
```

`createEmptyDocument()` backfills `vars: {}`, `varOrder: []`.

## Resolution — the consumer sites

Only three sites paint, and all already import from `paint.ts`
(grep: `resolvePaint|paintToCss|paintToSvgAttrs` →
[`render/scene.ts`](../src/canvas/render/scene.ts),
[`exportSvg.ts`](../src/io/exportSvg.ts),
[`ColorField.tsx`](../src/ui/ColorField.tsx)):

- **Canvas render** ([`render/scene.ts`](../src/canvas/render/scene.ts)): before switching on
  paint type for a node's fill/stroke, call `resolvePaint(paint, scope)` — the
  scope is the document's variables, plus a frame per enclosing symbol instance.
  `null` → skip that paint (same as no fill). Pattern resolution (asset cache)
  runs on the resolved paint as today.
- **SVG export** ([`exportSvg.ts`](../src/io/exportSvg.ts)): resolve first, then
  emit as normal. SVG gets baked concrete colors — no CSS-variable analogue is
  attempted (consistent with the "best-effort interchange" stance in the README).
- **CSS previews** (`paintToCss`, `resolveStyle`): these are pure and reference-blind
  by design. Callers that can see the document (ColorField, panels) resolve
  before calling them; the pure helpers stay unchanged.

Bounds, hit-testing, snapping, and geometry never read color, so they need no
changes.

## Editing model & store operations

Since v34 one slice, [`varSlice.ts`](../src/store/varSlice.ts), owns both kinds
of variable (it replaced `swatchSlice.ts` and `paramSlice.ts`). All mutations
route through the existing history/patch machinery so they are undoable like any
document op:

- `createVar(value, name?) => id` — add to `vars` + `varOrder`.
- `createColorVarFromSelection()` — read the selection's current fill (fallback:
  stroke), create a variable, and replace that paint with a reference in one step.
- `updateVar(id, { name | value })` — the live-recolor case; no node walk needed,
  references resolve to the new value on next render. A patch that would change
  the variable's *kind* is refused.
- `applyColorVar(id, target: "fill" | "stroke")` — set the selected nodes'
  fill/stroke to `varRef(id)`.
- `unlinkPaint(nodeIds, target)` — bake references back to concrete paint
  without deleting the variable.
- `deleteVar(id)` — detach every use first (paint references bake to concrete
  paint; bound number fields keep the number they show), then remove from
  `vars`/`varOrder`.
- `reorderVar(id, index)` — panel drag.
- `varUsageCounts(doc)` — one scan counting paint references *and* numeric
  bindings, for the panel + delete confirmation.

Reference discovery walks `doc.nodes` (and `path` children) checking
`fill`/`stroke` for `type === "var" && varId === id`. Brush/text/compound
nodes carry the same `fill`/`stroke` fields, so one walk covers all.

## UI

- **Variables panel** ([`src/ui/panels/vars/`](../src/ui/panels/vars/)) — one
  dockable panel with a Colors section and a Numbers section (v34 merged the
  Global colors and Parameters panels). Colour rows: paint chip, editable name,
  usage count. The palette button creates one from the current selection/fill. The chip is
  `ColorField` in its `variant="swatch"` form, so a global color is edited with
  exactly the control that edits any other paint — including switching it to a
  gradient. That variant drops what does not apply to a swatch: the label and
  caption (the row supplies the name), "None" (a swatch always has a paint) and
  the "Global colors" section (swatches never chain). Delete asks to confirm
  when usage count > 0 ("N objects will keep their current color").
- **ColorField** ([`ColorField.tsx`](../src/ui/controls/ColorField.tsx)) — a
  "Colors" section in the popover lists the document's colour variables; picking
  one sets a *reference*. Inside symbol-edit focus it also offers *Promote to
  symbol parameter*. It sits outside the per-type editors, since a global color can
  be any paint type. When the current paint is a reference, a link badge shows
  the variable's name (or the symbol parameter's label) and offers "unlink".
- **Every paint edit in the popover goes through one `commit(paint)`**, which
  writes to the linked swatch when the field is linked and to the field itself
  otherwise. That is what makes editing a *gradient* global behave like editing
  a solid one: restacking stops, dragging the angle or switching the paint type
  all retune the global and stay linked, rather than silently detaching. The one
  exception is "None", which is a property of the field, not of a color, so it
  drops the link.

## Persistence & migration

Bump `CURRENT_FILE_VERSION` 22 → 23 in [`serialize.ts`](../src/io/serialize.ts).
Migration is trivial and matches the v8 `symbols` precedent: for v8–v22 files,
backfill `swatches: {}` and `swatchOrder: []`. Add 22 to `MIGRATABLE_VERSIONS`
and extend the header comment. No node-level migration — `swatch` references
only appear in files authored after this ships.

Widening `Swatch.paint` to `ConcretePaint` bumps 32 → **v33**. It is a pure
widening, so v31/v32 files stay directly loadable (their swatches are all solid,
which is still valid) and both remain in `SUPPORTED_FILE_VERSIONS`. Only the
other direction breaks: a v33 file containing a gradient swatch is rejected by
an older build, which is exactly what the version bump is for.

Merging `swatches` into `vars` bumps 33 → **v34**. Unlike v33 this is not a pure
widening, so v31–v33 documents get a read-time transform (`migrateToV34` in
[`serialize.ts`](../src/io/serialize.ts)): swatches become `kind: "paint"`
variables, parameters `kind: "number"` ones, `varOrder` is the concatenation,
and each `swatch` paint becomes a `var` paint. Ids carry over unchanged, so the
transform is total and lossless and those versions stay supported.

## Validation

In [`sceneValidation.ts`](../src/model/sceneValidation.ts):

- Every `varOrder` id exists in `vars` and vice versa (bijection). The check
  itself lives in `hasValidVars` ([`vars.ts`](../src/model/vars.ts)) and is
  re-exported from `sceneValidation.ts`.
- No variable's paint is itself a reference (no chains/cycles). This one needs
  no runtime check in the scene validator: `ConcretePaint` excludes references
  at the type level, and `isConcretePaint` in `serialize.ts` enforces it at the
  only boundary untyped data crosses.
- A soft check (not a hard error) for `var` references whose `varId` is
  missing — render/export already tolerate these via the `null` fallback, but
  flagging them helps catch bad imports.

## Out of scope for v1 / future

- Gradient stops that point at a global color (per-stop resolution — a gradient
  *as* a global color is supported, a gradient *of* global colors is not).
- Color groups / harmonies, `.ase` palette import/export.
- ~~Merging `swatches` with `params` into one typed `vars` table, and
  per-instance colour overrides on symbols~~ — shipped in v34 (phase 2a of
  [parameters.md](parameters.md)).
- Exposing variable refs to the scripting DSL and generators — comes for free
  once `resolvePaint` is the single resolution point; only the authoring API
  needs surfacing.
- Recolor Artwork-style global remap UI.

## Open questions

- Should applying a global color to a *stroke* and *fill* from one entry be one
  row in the panel, or should fill/stroke be distinct pickers? (Leaning: one
  row, `applyColorVar` takes the target.)
- Tint UI: expose the per-use `alpha` tint in v1, or ship plain references first
  and add tint later? (Leaning: references first; the field is optional so tint
  is additive.)
