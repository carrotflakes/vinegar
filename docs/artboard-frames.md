# Artboards as container frames (plan)

Status: **implemented, phase 1** (2026-07-25). File version bumped to 24.
Pre-v24 files still open (the rest of the document migrates as before), but
their **artboards are intentionally not migrated to frames — they are dropped on
load**. The user recreates layout regions as frames. Prioritise a clean internal
model over carrying the old geometric artboards forward.

## Problem

Artboards are currently a flat list of world-space rectangles
(`doc.artboards: Artboard[]`) that **own no scene content**. Membership ("what
is on this board") is purely geometric. Everything that should be structural is
reimplemented by hand:

- `artboardContentIds` recomputes membership by AABB overlap on every move /
  duplicate.
- Content-aware move snapshots the overlapping roots and translates them
  alongside the board (`beginArtboardMove` + `onArtboardMove`).
- `duplicateArtboard` clones the board and re-clones the overlapping artwork.
- Snapping has to exclude the carried shapes to avoid stale "ghost" targets.
- Select-tool board editing needs bespoke picking (`pickArtboardBorder`,
  `hitArtboardHandle`) and a separate selection channel (`selectedArtboardId`).

These are all symptoms of one root cause: **membership is geometric, not a
parent/child relationship**. A shape overlapping two boards is ambiguous;
z-order across board + loose content is undefined; clip-to-board can't reuse the
existing clip machinery. The abstraction is wrong — the board should be a
container node in the scene graph, like `Group` (and like the clip group and
`CompoundPathNode` precedents, where hierarchy already lives in `childIds`).

## Decision

Make an artboard a **container node**: a "frame". Structurally a `Group` with a
fixed content box, a background, and export metadata. Children are real scene
nodes owned by the frame's `childIds`.

```ts
interface FrameNode extends BaseNode {
  type: "frame";
  /** Child node ids, back-to-front. May be empty. */
  childIds: string[];
  /** Content box size in the frame's LOCAL space (origin at 0,0). */
  width: number;
  height: number;
  /** Fill drawn behind children; null = transparent (checkerboard chrome). */
  background: string | null;
  /** Clip children to the content box. Defaults on (a frame is a viewport). */
  clip?: boolean;
}
```

Key modelling choices:

- **Local coordinate system.** A frame carries its own `transform` (BaseNode).
  Its content box is `[0,0,width,height]` in local space, i.e. an SVG-viewport.
  Children are authored in frame-local coordinates. This is the crucial
  departure from today's world-space rects, and it makes clipping fall out of the
  existing group/transform chain. The transform stays a full `Matrix`, but the UX
  only ever authors translation + resize — rotation is never offered (see Open
  questions), and nesting is forbidden by the top-level invariant below.
- **Fixed size, not content-derived.** Unlike `Group` (whose bounds are the
  union of its children), a frame's bounds are its own `width`/`height`.
  Resizing a frame changes the box; it does **not** scale children (matches
  Illustrator/Figma, and matches the artboard-resize rule we already chose).
- **Membership is structural.** "On the frame" ⇔ "descendant of the frame".
  The two-board ambiguity and undefined cross-z-order disappear.
- **Frames are always top-level (hard invariant).** A frame id appears *only*
  in `doc.rootIds`; `parentIdOf(frame)` is always `null`. No frame is ever a
  descendant of a group, symbol, or another frame — which also means frames
  never nest. This keeps the scope story exactly one level deep (root → inside a
  frame) and makes "export list = top-level frame nodes" precise. It is enforced
  in the model (serializer + every reparent/group op), not merely hidden in the
  UX.
- **Loose content stays at the scene root.** Frames are just some of the
  top-level `rootIds`; artwork outside any frame lives beside them as today.
- **Export list = frame nodes in document order.** `doc.artboards` and
  `selectedArtboardId` are removed. Export order = the order of frame nodes
  among `rootIds`; a frame is selected like any other node.

## What this reuses (the payoff)

Once a frame is a container recognised by the scene graph, most artboard-
specific code **deletes**, and the behaviour it hand-rolled becomes free:

| Today (geometric) | With frames (structural) |
| --- | --- |
| `artboardContentIds` + content snapshot | children follow the parent transform — nothing to compute |
| content-aware move in `onArtboardMove` | moving the frame node moves children for free |
| `duplicateArtboard` (+ re-clone artwork) | normal node duplicate (`duplicateSelected`) |
| snap excludes carried shapes | frame snaps like any node |
| `pickArtboardBorder` / `hitArtboardHandle` / `selectedArtboardId` | normal picking + selection + resize handles |
| board clip "deferred" | reuse `Group.clip` render + `<clipPath>` export |
| checkerboard bg "deferred" | `background: null` → existing transparent chrome |

Concretely, expect to remove most of `store/artboardSlice.ts`,
`canvas/tools/artboardTool.ts`, the artboard branches in `selectTool.ts` /
`interaction.ts` / `paint.ts`, and `pickArtboardBorder` / `pickLockedShape`'s
artboard-specific reasons. **This session's content-carry work is subsumed and
can be discarded.**

## Subsystem changes

- **types.ts**: add `FrameNode`; `SceneNode = Shape | Group | SymbolInstance |
  FrameNode`. Remove `Artboard`, `artboardBounds`, `makeArtboard`, and
  `Document.artboards`.
- **scene.ts / Scene Index**: `isContainer` includes `frame`; `childIdsOf` /
  `parentIdOf` / `sceneIndex` traverse it (they key off `isContainer`, so this
  is mostly a predicate change). Add `framesInPaintOrder(doc)` for the export
  list and panel. Decide the scope story (below).
- **bounds.ts / hitTest.ts**: a frame's local bounds are its content box
  `[0,0,w,h]` (NOT the children union) — special-case in `nodeLocalBounds`.
  World bounds and hit region flow through the normal transform + (if clipping)
  the clip rect. Hit-test inside a frame resolves to the frame (group-like
  drill), not straight to children.
- **render.ts**: a frame draws (1) background rect, (2) optional `ctx.clip()` to
  the content box, (3) children recursively — this is the group + clip path
  with a backdrop rect added. SVG export: `<g>` with a `<clipPath>` of the box
  and a background `<rect>`.
- **transforms / resize**: frame resize edits `width`/`height` (+ its transform
  origin), never child scale. Reuse `resizeBounds`; the "solo leaf folds scale
  into geometry" branch does not apply to frames.
- **export (`exportSvg`/`exportPng`/registry)**: per-frame export bounds =
  frame content box → world; background from the node. "Export all" iterates
  `framesInPaintOrder`.
- **selection / tools**: dedicated Artboard tool becomes optional — a frame can
  be created by a rectangle-like drag that produces a `FrameNode`, and edited
  as a normal node. Keep an explicit "Frame" tool for creation ergonomics.
  **Top-level invariant enforcement:** frame creation always appends to
  `rootIds`; grouping excludes frames (a selection containing a frame cannot be
  grouped, or the frame is left at root); reparent / move-into-container ops
  (incl. phase-2 drag-into-frame) reject a frame as the moved node. A frame is
  never a valid drop *child*.
- **Artboards panel**: a filtered view of frame nodes (list / rename / reorder =
  reorder among `rootIds` = export order / select). Frames can additionally
  appear in the Layers tree (they are real nodes) — decide whether to show them
  in both.
- **serialize.ts**: bump `CURRENT_FILE_VERSION`; drop `artboards` from the
  document validator; add `frame` to the node validator (container with
  `childIds` + `width`/`height`/`background`). **Validate the top-level
  invariant:** reject any document where a frame id appears outside `doc.rootIds`
  (in some node's `childIds` or a symbol-def subtree), or where a frame's own
  descendants contain a frame. Pre-v24 files open but their `doc.artboards` are
  dropped (not converted to frames).
- **demo / createDemoDocument.ts, document-model.md**: rebuild the demo with a
  frame node; update the model doc.

## Scope / editing inside a frame

Frames define a coordinate scope like groups. Two options:

1. **Reuse group-drill** (`activeGroupId`): double-click a frame to enter it;
   children edit in frame-local space via the existing drill machinery. Least
   new code. **Preferred for phase 1.**
2. Full symbol-style scope. Overkill.

**Invariant (not a phase restriction): frames only ever live at the top-level
scene scope** — never inside a symbol, group, or another frame. This is the hard
top-level invariant stated above, enforced in the model rather than hidden in
the UX. Editing a frame's children is therefore always a single drill from root.

## Open questions

- **Reparent on drag** (Figma: dragging a shape into/out of a frame changes its
  parent). This is the main new interaction surface. **Defer to phase 2**;
  phase 1 changes membership only via the Layers panel / an explicit "move into
  frame" action, so scope stays bounded.
- **Rotation.** Decided: **not offered in the UX, ever.** The frame `transform`
  stays a full `Matrix` (so local space / clip / bounds reuse the generic
  pipeline), but only translation + resize are ever authored — no rotation
  handle, no rotation gesture. Boards stay axis-aligned in practice; the model is
  *not* constrained to translation-only, so nothing extra is enforced and the
  decision is cheap to revisit.
- **Nested frames.** Decided against — forbidden by the top-level invariant (see
  Decision). A frame is never inside any container.
- **Instances of frames?** Out of scope — frames are layout containers, symbols
  are the reuse primitive.

## Phasing

- **Phase 0** — this document.
- **Phase 1 (vertical slice, breaks the file format):** `FrameNode` type +
  `isContainer`/Scene Index recognition; render (bg + clip + children); bounds
  & hit = content box; create (Frame tool); resize the box; move/duplicate/
  delete via normal node ops; Layers + Artboards-panel integration; export
  bounds from the frame; drop `doc.artboards` + `selectedArtboardId`. Delete the
  geometric artboard code (this session's included). Rebuild the demo.
- **Phase 2:** reparent-on-drag ✅ (dropping a moved selection over a frame
  re-homes it into that frame — or back out to the scene root — preserving world
  position, as one undo step, with a live drop-target highlight). Remaining
  polish: transparent-background checkerboard (editor-only chrome; needs an
  editor flag threaded through `paintNode` so export stays transparent),
  per-frame export-settings wiring. (Rotation handle and nested-frame UX are
  permanently out — see Open questions.)

## Non-goals

Converting old `doc.artboards` into frames (pre-v24 artboards are dropped on
load), auto-reparent in phase 1. **Rotated frames
— no rotation UX, ever (the model keeps a full transform, but only translation +
resize are authored).** **Nested frames — permanently out: frames are a
top-level invariant, never inside any container.**
