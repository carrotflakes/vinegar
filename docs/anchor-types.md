# Anchor types (cusp / smooth / symmetric)

Status: **implemented** (design agreed and implemented 2026-07-26). File
version: **no bump required** (additive and *optional* — absent `t` ⇒ derived
from geometry, and `io/serialize.ts` anchor validation ignores extra keys).
Related: [brush-strokes.md](brush-strokes.md) (brush anchors share the
`p`/`hIn`/`hOut` shape), [path-unification.md](path-unification.md).

## Problem / motivation

Dragging a Bézier control handle in the node tool currently mirrors the
opposite handle **point-symmetrically about the anchor** — angle *and* length
(`moveHandle` in `canvas/nodes.ts`):

```ts
const mirror: Vec2 = { x: 2 * a.p.x - world.x, y: 2 * a.p.y - world.y };
```

The caller (`canvas/tools/nodeTool.ts`) passes `!altKey`, so there are only two
behaviours: fully symmetric, or fully independent (Alt).

That is **not the usual default**. Every comparable editor distinguishes three
kinds of anchor:

| kind | dragging one handle | Illustrator | Inkscape | Figma |
| --- | --- | --- | --- | --- |
| **cusp** | the other stays put | corner point | cusp | no mirroring |
| **smooth** | the other **rotates, keeping its length** | smooth point (the default) | smooth (the default) | mirror angle |
| **symmetric** | the other mirrors angle *and* length | — | symmetric | mirror angle and length |

Illustrator's smooth anchor keeps the opposite handle's length; Inkscape only
mirrors length on a node explicitly made *symmetric*. Point symmetry as the
sole default makes long curves hard to tune: lengthening one side silently
rescales the other.

## Decision (data model)

Add an **optional** type tag to both anchor interfaces in `model/types.ts`:

```ts
export type AnchorType = "cusp" | "smooth" | "symmetric";

export interface PathAnchor {
  p: Vec2;
  hIn: Vec2 | null;
  hOut: Vec2 | null;
  /** Handle-linkage rule. Absent ⇒ derived from the handle geometry. */
  t?: AnchorType;
}
// BrushAnchor gains the same optional `t`.
```

**`t` is optional and absent by default.** When it is missing, the type is
*derived* from the handles:

- both handles `null` ⇒ `cusp`
- handles collinear through `p` (cross product within epsilon) and of equal
  length (within epsilon) ⇒ `symmetric`
- handles collinear ⇒ `smooth`
- otherwise ⇒ `cusp`

This is the whole reason the change stays small. Anchors are constructed in a
lot of places — `model/generators/generators.ts` (every parametric shape),
`model/path/freehand.ts`, `model/brush/brushOutline.ts`, `model/path/boolean.ts`,
`model/path/roundedRect.ts`, `io/importSvg.ts`, `canvas/tools/penTool.ts`,
`canvas/tools/shapeTools.ts` — and **none of them need to change**: they emit
geometry, and the derivation reads the intent back out. `t` exists only to
record a choice the *user* made explicitly, where geometry alone is ambiguous

(One exception has since appeared: the pen tags the anchor it is dragging
handles out of, `cusp` when Alt breaks the linkage — or when continuing an
existing endpoint, which only pulls the outgoing handle — and `symmetric`
otherwise. That is a user choice made at draw time, so it is exactly the case
`t` is for; leaving it derived would let a later Node-tool edit re-link handles
the user deliberately broke.)

The ambiguous case `t` guards against: a smooth anchor whose handles happen to
be equal length must not silently behave as symmetric once tagged.

Epsilons are relative to the handle lengths, not absolute, so the derivation is
scale-independent.

## Behaviour

`moveHandle` becomes a three-way branch on the effective type:

- **cusp** — write only the dragged handle.
- **smooth** — the opposite handle keeps `|hOpp|` and takes the direction
  opposite the dragged one. Degenerate case: if the dragged handle lands on the
  anchor (zero length, direction undefined), keep the opposite handle as-is.
- **symmetric** — today's point mirror.

Modifier keys, unchanged in spirit:

- **Alt** — drag as if `cusp`, *and* commit `t: "cusp"` on the anchor. Breaking
  the tangent is a real edit of the anchor's kind, not a transient override;
  leaving `t` at `smooth` with non-collinear handles would be a lie the
  derivation could not represent.
- Shift keeps its current 45°-constraint meaning.

Anchor-reshaping ops:

- `reversePath` / `reverseSubpath` (`model/path/path.ts`) swap `hIn`/`hOut`;
  `t` carries over unchanged (all three types are symmetric under reversal).
- `cutPath.ts` `severAnchor` — the two new endpoints become `cusp`.
- `joinPath.ts` junction/merged anchors — `cusp`.
- Transforms (`geometry/transforms.ts`) map handles affinely: a non-uniform
  scale breaks equal length, so a *tagged* `symmetric` anchor should either be
  re-normalized or demoted to `smooth`. Chosen: **demote to `smooth`** under
  non-uniform scale (re-normalizing would move geometry the user did not drag);
  uniform scale/rotation keeps `t`.

## Type switching

`setAnchorType(a, t)` normalizes geometry when the type changes, so the tag and
the shape always agree:

- → `cusp`: handles kept as-is (only the linkage is dropped).
- → `smooth`: both handles keep their lengths; direction becomes the average
  tangent (bisector of the current handle directions). Missing handles are
  synthesized from the neighbours, as `toggleAnchorSmooth` already does.
- → `symmetric`: as `smooth`, then both lengths set to their mean.

`toggleAnchorSmooth` (path) / `toggleBrushAnchorSmooth` (brush) — the node
tool's double-click — keeps its current corner ↔ smooth toggle, but now writes
`t` explicitly through `setAnchorType`.

## Pen tool default

A point created by dragging in the pen tool emits equal-length collinear
handles and writes **no `t`** — the derivation calls it `symmetric` on the first
handle drag, which matches what the user just drew, and any later edit that
breaks equal length settles it into `smooth`. No special case needed. (If this
feels wrong in practice, tagging pen-drag points `smooth` is a one-line change.)

## UI

- **`ui/panels/properties/NodeTypeSection.tsx`** (new) — a three-way segmented
  control shown when anchors are selected, modelled directly on the existing
  `NodeWidthSection.tsx` (same visibility rule off `editNodes`, same
  multi-selection semantics: mixed types show no active segment; picking one
  applies to every selected anchor).
- **`store/shapeSlice.ts`** — `setEditNodeType(t: AnchorType)`, grouped by shape
  like `setEditNodeWidths`, one `transact` labelled "Change anchor type".
- **`canvas/overlay.ts`** (`drawNodes`, line ~299) — draw the anchor marker by
  type, Inkscape-style: square = cusp, circle = smooth, diamond = symmetric.
  Optional but cheap, and it makes the state legible without the panel.
- **Handle visibility** (added later): `drawNodes` only draws the handles
  `visibleHandleKeys` (`model/nodeEdit.ts`) returns — the selected anchors'
  own handles plus the neighbouring handles facing them — and `hitNodes` takes
  the same set, so a handle that isn't drawn can't be grabbed. The
  `canvas.showAllHandles` preference restores the draw-everything behaviour.
- Context menu / shortcut entries can follow later; not required for v1.

**Vocabulary.** Two different operations are easy to confuse, so they keep
different words everywhere (hints, README, panel tooltips):

- **corner** — the node tool's double-click: *removes* both handles, giving a
  straight-sided anchor. The pre-existing meaning of `hIn`/`hOut === null`.
- **cusp** — the panel segment and Alt-drag: the handles stay where they are,
  only their linkage is dropped. This is the Inkscape sense of the word.

## Files touched

| file | change | size |
| --- | --- | --- |
| `model/types.ts` | `AnchorType`, `PathAnchor.t?`, `BrushAnchor.t?` | few lines |
| `model/path/anchorType.ts` (new) | derivation + `setAnchorType` normalization | ~60 lines |
| `canvas/nodes.ts` | `moveHandle` three-way branch | ~30 lines |
| `model/path/path.ts`, `model/brush/brushEdit.ts` | toggles write `t` | small |
| `model/path/cutPath.ts`, `model/path/joinPath.ts` | new endpoints/junctions ⇒ `cusp` | 1–2 lines each |
| `model/geometry/transforms.ts` | demote tagged `symmetric` under non-uniform scale | small |
| `store/shapeSlice.ts`, `store/state.ts` | `setEditNodeType` | small |
| `ui/panels/properties/NodeTypeSection.tsx` (new) | segmented control | ~medium |
| `canvas/overlay.ts` | per-type anchor markers | small |
| `tests/nodeEditing.test.mjs` | see below | — |

Roughly 200–300 lines total; most files are one- or two-line edits.

## Tests

Extend `tests/nodeEditing.test.mjs`:

- derivation: null handles ⇒ cusp; collinear equal ⇒ symmetric; collinear
  unequal ⇒ smooth; non-collinear ⇒ cusp; scale-independence of the epsilon.
- `moveHandle` on a `smooth` anchor preserves `|hOpp|` and flips its direction.
- `moveHandle` with Alt writes `t: "cusp"` and leaves the opposite handle.
- degenerate drag onto the anchor does not NaN the opposite handle.
- `setAnchorType` round-trips: smooth → symmetric → smooth keeps collinearity.
- reverse keeps `t`; cut/join produce `cusp` endpoints.
- `tests/serialize.test.mjs`: a document with tagged anchors round-trips, and a
  document without `t` still loads (no version bump).

## Deferred

- Inkscape's fourth **auto** type (handles continuously re-fitted from the
  neighbours).
- Dragging an anchor's *position* re-fitting neighbouring auto handles.
- Per-type keyboard shortcuts. (Context-menu entries have since landed:
  right-clicking an anchor with the node tool opens `nodeMenu()` with the three
  types, "Cut path" and "Delete".)
