# Global colors (document swatches) — design

Status: implemented (v1, file format v23). The two open questions below were
resolved per their "leaning": one swatch with `applySwatch(id, target)` for
fill vs. stroke, and plain references first (no per-use tint UI yet — the
`alpha` field exists on `SwatchRefPaint` and resolves, but nothing authors it).

A **global color** is a named color stored on the document. Any number of nodes
reference it by id instead of holding their own color; editing the global color
once re-tints every referencing node live. Think "CSS variable for paint".

This is distinct from the existing personal **saved swatches** in
[`prefsSlice.ts`](../src/store/prefsSlice.ts) (see below).

## Decisions up front

- **Reference, don't copy.** A node's `fill`/`stroke` can be a new `swatch`
  Paint variant that only holds a `swatchId`. The concrete color lives once, in
  `doc.swatches`. This is what makes "edit once, update everywhere" fall out for
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
- **v1 is solid-only.** A global color holds a `SolidPaint`. Gradients that
  reference globals per-stop, and pattern-of-global, are future work (they need
  reference resolution *inside* stops). The data model below does not preclude
  them.
- **Optional per-use tint.** A `swatch` reference may carry `alpha` (0..1) to
  tint that one usage on top of the swatch's own alpha, matching Illustrator's
  global-color tint. Absent = 1 (use as-is).
- **Deleting a global color detaches, never silently breaks.** On delete, every
  reference is first resolved to a concrete solid paint (baked in place), then
  the swatch is removed. No dangling ids survive a delete.

### Global colors vs. the existing saved swatches

| | Saved swatches (today) | Global colors (this doc) |
|---|---|---|
| Stored in | user prefs ([`prefsSlice.ts`](../src/store/prefsSlice.ts)) | the document (`doc.swatches`) |
| Scope | all documents (personal palette) | one document |
| Applying | copies the color into the node | links the node to the swatch |
| Editing later | no effect on past uses | re-tints every reference live |

They are complementary and both stay. To avoid UI confusion, the document ones
are labelled **"Global colors"** (never just "swatches"); the shipped panel and
the ColorField section both use that label.

## Data model

Add to [`paint.ts`](../src/model/paint.ts):

```ts
export interface SwatchRefPaint {
  type: "swatch";
  /** Id of a Swatch in doc.swatches. */
  swatchId: string;
  /** Optional per-use tint 0..1, multiplied onto the swatch's own alpha. */
  alpha?: number;
}

export type Paint = SolidPaint | GradientPaint | PatternPaint | SwatchRefPaint;

export function swatchRef(swatchId: string, alpha?: number): SwatchRefPaint {
  return alpha == null
    ? { type: "swatch", swatchId }
    : { type: "swatch", swatchId, alpha: clamp01(alpha) };
}

/** Resolve a possibly-referential paint to a concrete one. Returns null for a
 *  dangling reference so callers can fall back (render: skip; export: omit). */
export function resolvePaintRef(
  paint: Paint | null,
  swatches: Record<string, Swatch>
): Exclude<Paint, SwatchRefPaint> | null {
  if (paint == null) return null;
  if (paint.type !== "swatch") return paint;
  const s = swatches[paint.swatchId];
  if (!s) return null; // dangling — treat as no paint
  const base = s.paint;
  if (paint.alpha != null && base.type === "solid") {
    return { ...base, alpha: clamp01(base.alpha * paint.alpha) };
  }
  return base;
}
```

Add to [`types.ts`](../src/model/types.ts) `Document`:

```ts
export interface Swatch {
  id: string;
  name: string;
  /** Concrete paint. v1: SolidPaint. Never a SwatchRefPaint. */
  paint: SolidPaint;
}

// Document:
swatches: Record<string, Swatch>;
/** Panel display order. Every id here exists in `swatches` and vice versa. */
swatchOrder: string[];
```

`createEmptyDocument()` backfills `swatches: {}`, `swatchOrder: []`.

## Resolution — the consumer sites

Only three sites paint, and all already import from `paint.ts`
(grep: `resolvePaint|paintToCss|paintToSvgAttrs` →
[`render.ts`](../src/canvas/render.ts),
[`exportSvg.ts`](../src/io/exportSvg.ts),
[`ColorField.tsx`](../src/ui/ColorField.tsx)):

- **Canvas render** ([`render.ts`](../src/canvas/render.ts)): before switching on
  paint type for a node's fill/stroke, call `resolvePaintRef(paint, doc.swatches)`.
  `null` → skip that paint (same as no fill). Pattern resolution (asset cache)
  runs on the resolved paint as today.
- **SVG export** ([`exportSvg.ts`](../src/io/exportSvg.ts)): resolve first, then
  emit as normal. SVG gets baked concrete colors — no CSS-variable analogue is
  attempted (consistent with the "best-effort interchange" stance in the README).
- **CSS previews** (`paintToCss`, `resolvePaint`): these are pure and swatch-blind
  by design. Callers that can see the document (ColorField, panels) resolve
  before calling them; the pure helpers stay unchanged.

Bounds, hit-testing, snapping, and geometry never read color, so they need no
changes.

## Editing model & store operations

New slice `swatchSlice.ts` (peer of [`symbolSlice.ts`](../src/store/symbolSlice.ts)),
all mutations routed through the existing history/patch machinery so they are
undoable like any document op:

- `createSwatch(name, paint) => id` — add to `swatches` + `swatchOrder`.
- `createSwatchFromSelection()` — read the selection's current fill (fallback:
  stroke), create a swatch, and replace that paint with a reference in one step.
- `updateSwatch(id, paint | name)` — the live-recolor case; no node walk needed,
  references resolve to the new value on next render.
- `applySwatch(id, target: "fill" | "stroke")` — set the selected nodes'
  fill/stroke to `swatchRef(id)`.
- `unlinkPaint(nodeIds, target)` — bake references back to concrete paint
  (`resolvePaintRef`) without deleting the swatch.
- `deleteSwatch(id)` — bake every reference to concrete paint across all nodes,
  then remove from `swatches`/`swatchOrder`.
- `reorderSwatch(id, index)` — panel drag.
- `swatchUsageCount(id)` — count referencing fill/stroke for the panel + delete
  confirmation.

Reference discovery walks `doc.nodes` (and `path` children) checking
`fill`/`stroke` for `type === "swatch" && swatchId === id`. Brush/text/compound
nodes carry the same `fill`/`stroke` fields, so one walk covers all.

## UI

- **Global colors panel** — a dockable panel like the Assets panel
  ([`src/ui/panels/`](../src/ui/panels/)). Rows: color chip, editable name,
  usage count. `+` creates from the current selection/fill. Double-click the
  chip opens the color popover and edits the global live. Drag a row onto the
  canvas / a selection applies it as a reference. Delete asks to confirm when
  usage count > 0 ("N objects will keep their current color").
- **ColorField** ([`ColorField.tsx`](../src/ui/ColorField.tsx)) — add a
  "Global colors" section to the popover listing `doc.swatches`; picking one
  sets a *reference*. When the current paint is a reference, show a link badge +
  the swatch name and an "unlink" action. Editing color while linked edits the
  global (with an affordance to unlink first if the user wants a one-off).

## Persistence & migration

Bump `CURRENT_FILE_VERSION` 22 → 23 in [`serialize.ts`](../src/io/serialize.ts).
Migration is trivial and matches the v8 `symbols` precedent: for v8–v22 files,
backfill `swatches: {}` and `swatchOrder: []`. Add 22 to `MIGRATABLE_VERSIONS`
and extend the header comment. No node-level migration — `swatch` references
only appear in files authored after this ships.

## Validation

In [`sceneValidation.ts`](../src/model/sceneValidation.ts):

- Every `swatchOrder` id exists in `swatches` and vice versa (bijection).
- No `Swatch.paint` is a `swatch` reference (no chains/cycles).
- A soft check (not a hard error) for `swatch` references whose `swatchId` is
  missing — render/export already tolerate these via the `null` fallback, but
  flagging them helps catch bad imports.

## Out of scope for v1 / future

- Gradient stops and pattern references that point at a global color (per-stop
  resolution).
- Color groups / harmonies, `.ase` palette import/export.
- Exposing swatch refs to the scripting DSL and generators — comes for free
  once `resolvePaintRef` is the single resolution point; only the authoring API
  needs surfacing.
- Recolor Artwork-style global remap UI.

## Open questions

- Should applying a global color to a *stroke* and *fill* from one swatch be one
  entry in the panel, or should fill/stroke be distinct pickers? (Leaning: one
  swatch, `applySwatch` takes the target.)
- Tint UI: expose the per-use `alpha` tint in v1, or ship plain references first
  and add tint later? (Leaning: references first; the field is optional so tint
  is additive.)
