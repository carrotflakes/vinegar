# Path modifiers (plan)

Status: **proposed** (design agreed 2026-07-24; not yet implemented). File
version: **bump TBD** (additive — absent `modifiers` ⇒ no change, so a no-op
migration). Related: extends the generator concept
([document-model.md](document-model.md)); models on `effects`; overlaps
[path-unification.md](path-unification.md) (v21) and
[compound-path-nodes.md](compound-path-nodes.md) (v22).

## Problem / motivation

Path cleanups (Simplify, Flatten, Offset, …) currently **bake once** into
`subpaths` (`model/pathOps.ts`, one-shot commands). The user wants them to be
**non-destructive, re-editable modifiers** — a Blender-style modifier stack —
so a tolerance (or offset distance, etc.) can be tuned at any time with a live
preview, and removed or reordered without losing the original geometry.

The repo already has the right precedent: **`effects`**
(`BaseNode.effects?: Effect[]`) is an ordered, non-destructive stack evaluated
downstream. Modifiers are the **geometry** counterpart of effects:

| | `effects` (shipped) | `modifiers` (this plan) |
| --- | --- | --- |
| transforms | appearance (blur, shadow) | **geometry** (`subpaths`) |
| evaluated in | render + SVG export only | render + hit-test + bounds + snap + SVG export + node tool |
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
  | { type: "smooth" }
  | { type: "reverse" };
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
harder; deferred), per-fill/stroke modifiers.

## Evaluation & caching

`resolvedSubpaths(node)` is a pure function of `(subpaths, modifiers)`. Because
the same result feeds render, hit-test, bounds, snap and export within a frame,
recomputing per call is wasteful. Options, cheapest first:

1. **Memo keyed on identity** — cache `{ subpaths, modifiers } → resolved` in a
   `WeakMap`-ish per-node cache invalidated by the node object identity (edits
   are immutable, so a new node object ⇒ recompute). Simplest; matches the
   immutable-doc model. **Recommended for v1.**
2. Store a derived `_resolved` alongside on transact (denormalized) — faster but
   risks drift; rejected.

Modifier ops reuse the existing paper.js / clipper machinery already used by
`model/pathOps.ts` (simplify/smooth/flatten) and `model/outlineStroke.ts`
(clipper offset). No new geometry engine.

## Read-site impact (the real cost)

Every current reader of `.subpaths` must be classified as **base** or
**resolved**. This is the blast radius (files found via `grep -rl '\.subpaths'`):

**Must switch to `resolvedSubpaths(node)`:**
- `canvas/render.ts` — fill/stroke the resolved outline
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
- **Detach / Apply** buttons (mirror the generator's "Detach"): *Apply* bakes
  the resolved geometry into `subpaths` and clears `modifiers`
  (`convertToPath`-style); *Remove* drops a single modifier.

## Export & serialization

- **SVG/PNG**: emit resolved geometry (modifiers are baked at export time; no
  SVG modifier concept, unlike effects' `<filter>`). Export bounds already use
  resolved geometry once render does.
- **File format**: additive `modifiers?` field; absent ⇒ unchanged. A
  document that opens in an older build loses interactivity but not shape (if we
  also keep a baked `subpaths`… **decide**: do we persist base-only, or
  base+lastResolved for forward-compat? Recommend base-only + modifiers).

## Open questions / deferred

- Offset of open paths (one-sided vs two-sided) — reuse `outlineStroke.ts`
  clipper path; needs the same join/side options.
- Boolean-as-modifier (needs a second operand reference) — deferred.
- Modifiers on non-path shapes (auto-convert-on-add?) — deferred.
- Interaction with `brush` width profile and `compoundPath` children — v1 scopes
  to plain `path` nodes only.
- Caching strategy under heavy documents (ties into
  [render-performance.md](render-performance.md) culling/caching work).

## Phasing

1. **Vertical slice** (de-risk the blast radius): `modifiers?: Modifier[]` +
   `resolvedSubpaths()` with the identity-memo cache; route **render + hit-test
   + bounds** through it; ship **one** modifier (Simplify) with a live-tolerance
   Modifiers panel section. Prove edit→preview→commit and undo end-to-end.
2. Route the remaining resolved readers (stroke, boolean, bucket, clip, outline,
   SVG export, snap, overlay). Add Apply/Detach.
3. Fill out the modifier set (Flatten, Smooth, Reverse, Offset).
4. Reorder/enable UI polish; context-menu "add modifier" entries.

## Sequencing vs. roadmap

v21 path-unification is **done** (subpaths is already the canonical path
geometry), so the base type is ready — no need to wait. v22 compound-path-nodes
(real children) will need `resolvedSubpaths` to compose across children; keep the
resolver a pure `(node, doc)` function so v22 can recurse. Build modifiers on the
current model; keep the resolver signature v22-friendly.
