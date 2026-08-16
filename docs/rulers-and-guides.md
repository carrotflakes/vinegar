# Rulers and guides — design

Status: v1 shipped (file format v28). Horizontal/vertical rulers along the top
and left edges of the canvas, persistent document guides dragged out of them,
and guide snapping alongside the existing object/grid snapping.

## Decisions up front

- **Guides belong to the document, not to a frame.** `doc.guides` is a flat
  list of world-space lines. Frame-owned guides (Illustrator's per-artboard
  model) would have to follow their frame when it moves and be re-parented on
  drop; that is a second, parallel positioning story for no v1 benefit. Frames
  still matter for *display*: the rulers count from the frame under the viewport
  centre (see below).
- **Horizontal and vertical only.** A guide is `{ id, axis, position }` where
  `axis: "x"` is a vertical line at world x = `position`. Diagonal guides need a
  general line form plus rotated hit-testing and snapping, and are rare; the
  union can gain a variant later without touching this one.
- **Rulers display frame-relative numbers, guides store world coordinates.** The
  displayed origin is the top-left corner of the **active frame**, else the
  world origin. This is display-only: nothing in the model is expressed relative
  to a frame.
- **The active frame is explicit state, not a guess from the viewport.**
  `EditorData.activeFrameId` follows deliberate acts — selecting a frame or
  anything inside one, or creating a frame — and is otherwise sticky: panning,
  zooming and clearing the selection leave it alone. This mirrors Illustrator's
  active-artboard rule. An earlier version derived the origin from whichever
  frame sat under the viewport centre, which meant the numbers changed as you
  scrolled past a frame edge; deriving it from the viewport is exactly the thing
  a ruler origin must not do.
- **Frame vs. document origin is a preference.** `canvas.rulerOrigin`
  (`"frame"` default / `"world"`) in the Preferences dialog mirrors
  Illustrator's Artboard Rulers vs. Global Rulers. `"world"` ignores
  `activeFrameId` entirely at paint time; the state keeps tracking so switching
  back needs no re-selection. `view.resetRulerOrigin` clears `activeFrameId`
  without leaving frame mode (`setActiveFrame(null)`), for when the origin is
  parked on a frame you are no longer working in.
- **Guides are not scene nodes.** They never appear in the Layers panel, are not
  part of `selection`, and have no transform/appearance. Selection is a single
  `selectedGuideId` in the store, cleared like any other transient state. This
  keeps every node-shaped code path (grouping, z-order, export, symbols,
  clipboard) untouched.
- **Editing a guide is an ordinary undoable document edit.** Create, move,
  delete and Clear all go through the normal history transaction machinery;
  `guides` is an array field in `documentPatches.ts` like `rootIds`.
- **Rulers are canvas chrome, not DOM.** They are drawn in `paint.ts` after the
  scene, in screen space, like frame labels and alignment guides — so they cost
  no layout, follow the canvas theme, never appear in exports (which use
  `renderScene` directly), and hit-testing stays inside the existing pointer
  pipeline instead of a second overlay element with its own coordinate math.
  (This reverses an earlier lean toward a DOM ruler bar: the tick text is the
  only thing DOM would have made easier, and `drawFrameLabels` already proves
  canvas text is fine here.)
- **Show / lock / snap are session preferences, not document state.** They live
  in `localStorage` next to the existing snap toggles. Whether *you* are
  currently looking at guides is not a property of the drawing.

## Model

```ts
// model/types.ts
export interface GuideLine {
  id: string;
  /** "x" = a vertical line at world x = position; "y" = horizontal at y. */
  axis: "x" | "y";
  position: number;
}

interface Document {
  // …
  guides: GuideLine[];
}
```

File version 28. As always there is no migration: v27 files are rejected with
the usual message.

## Rulers

`canvas/rulers.ts` owns the geometry and drawing:

- `RULER_SIZE` (20 px) bands along the top and left, plus the corner square.
- `rulerAxisMap(viewport, size)` samples the world position at two screen points
  along each band and returns an affine `screen ↔ world` map per band, together
  with which world axis that band actually measures. Under a rotation that is
  not a multiple of 90°, lines of constant world x are not vertical on screen,
  so no tick spacing is meaningful: the band is drawn empty. Multiples of 90°
  (including the view flip) work, with the axis swapped or the direction
  reversed as needed.
- `niceStep(min)` picks a 1/2/5×10ⁿ step targeting ~72 px between labelled
  ticks. Labels are drawn in the document unit (`doc.settings.unit`/`dpi` via
  `model/units.ts`), so a mm document reads in mm, and count from
  `rulerOrigin(doc, activeFrameId)`.
- The cursor position and the selection extent are shaded on each band.

## Interaction

All of it lives in the existing pointer pipeline
(`hooks/usePointerHandlers.ts`), ahead of the tool dispatch:

- **Press inside a ruler band** (rulers shown, guides unlocked) creates a guide
  of the perpendicular axis and immediately starts dragging it. Releasing back
  over a ruler band or past the canvas edge behind it cancels the creation.
- **Press within 4 px of an existing guide** (select/node tool, guides shown and
  unlocked) selects and drags it. Guides take priority over shapes under the
  cursor — they are thin targets, and Lock Guides is the escape hatch.
- **Dragging** snaps the guide through the same `snapPoint` used by shape
  creation, so a guide lands on object edges/centres and the grid.
- **Delete/Backspace** removes the selected guide (`edit.delete` checks the
  guide selection first). Dragging a guide onto a ruler or past the canvas edge
  behind it also deletes it.
- Escape cancels a guide drag through the normal interaction rollback.

## Snapping

`SnapContext`/`PointSnapContext` gained a `guideLines: { x: number[]; y: number[] }`
field. Guide candidates reuse `alignSnap` with the moving box's own
perpendicular extent, so a snapped guide draws the usual magenta feedback line
over the guide instead of an infinite one. Guides are only offered as targets
when they are visible and "Snap to guides" is on (a hidden guide that still
grabbed the cursor would be baffling).

## Deferred

- Numeric entry / double-click to place a guide at an exact coordinate.
- Per-frame guides, and a ruler origin the user can drag to an arbitrary
  point (Illustrator's corner-box drag).
- Other ways to activate a frame: clicking a frame's empty background, or a
  frame-list UI. Today only selection and creation do it.
- Diagonal guides, and "Make guides from selection".
- Guides inside symbol definitions (the scene's guides show in symbol edit mode
  today; they are not part of the definition).
- Rulers under an arbitrary canvas rotation.
