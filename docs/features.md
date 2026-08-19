# Feature reference

Status: **reference.** A map of what exists — one line per feature, linking to
the note that explains it. Deliberately terse: the running app is the authority
on how a feature behaves, and the design notes carry the reasoning. Anything not
built yet belongs in [../TODO.md](../TODO.md), not here.

## Tools

Select, Edit Nodes, Rectangle, Ellipse, Line, Pen, Brush, Eraser, Pencil, Bucket
Fill, Text, Frame.

- **Pen** — click for corner anchors, drag for smooth ones, Alt for a cusp;
  continues an existing open path; an on-canvas Done / Close / Undo / Discard bar
  means it needs no keyboard.
- **Pencil** — freehand, simplified and smoothed into an editable Bézier, with a
  Close option (*Never* / *Near start* / *Always*); can extend a selected open path.
- **Brush** — pressure capture; strokes stay editable centerlines with a derived
  variable-width envelope. See [brush-strokes.md](design/brush-strokes.md)
- **Eraser** — splits or trims brush strokes, preserving geometry and width profile.
- **Bucket Fill** — vector region detection (no raster tracing) with adjustable
  gap closing. See [bucket-fill.md](design/bucket-fill.md)

## Editing geometry

- Node editing: cusp / smooth / symmetric anchors, curve-preserving insertion,
  multi-anchor selection. See [anchor-types.md](design/anchor-types.md)
- Handles are drawn *and* hit-tested only around the selected anchors; a **Show
  all handles** preference restores the old behaviour.
- Move, resize and rotate through per-node affine matrices, so rotated and nested
  resize stay exact. Shift locks the axis, Alt duplicates and drags the copy.
- Rectangle corner radius, movable transform origins, and a hover outline showing
  what a click would take (including locked nodes it would pass through).
- Multi-select, arrow-key nudge, copy / cut / paste / duplicate, numeric X/Y/W/H,
  align & distribute, arrange.
- Undo / redo, plus a History panel that jumps to any retained state. See
  [undo-history.md](reference/undo-history.md)

## Structure

- **Group / ungroup**, nested.
- **Clipping masks** — the frontmost child clips its group. See
  [clipping-masks.md](design/clipping-masks.md)
- **Compound paths** — closed children as real layer nodes under one shared
  even-odd appearance, still node-editable, releasable.
- **Frames** — top-level container nodes with their own coordinate space, a
  background and a clip toggle; their z-order in the Layers tree is the export
  order. See [document-model.md](document-model.md)
- **Symbols** — definitions and instances. See [symbols.md](design/symbols.md)
- **Focus mode** — isolate a frame, group or symbol and edit only its content.
  See [focus.md](design/focus.md)
- **Layers panel** — tree view, drag to reorder across parents, rename, context
  menu, range and toggle selection, and hover/reveal linking rows to the canvas
  both ways.

## Path operations

- **Boolean**: union, subtract, intersect, exclude, and **Divide** into faces
  (Paper.js, curve-preserving, node-editable results).
- **Join**, **Cut**, **Combine**, **Split subpaths**, and one-shot **Simplify /
  Smooth / Flatten / Reverse**. See [path-commands.md](reference/path-commands.md)
- **Convert to path** and **Outline stroke**.
- **Path modifiers** — the same operations as a non-destructive, re-editable
  stack on paths, rectangles, ellipses and lines. See
  [path-modifiers.md](design/path-modifiers.md)

## Appearance

- **Paint**: solid with per-colour alpha; linear / radial / conic gradients with
  an on-canvas tool ([gradients.md](design/gradients.md)); freeform gradients
  ([freeform-gradients.md](design/freeform-gradients.md)); raster patterns with
  tile / fill / fit / stretch placement.
- **Stroke**: width, dash pattern and offset, cap, join, inside/center/outside
  alignment. Plus per-node opacity and blend modes.
- **End markers** on every open end — arrow, triangle, circle, square, diamond,
  bar. See [markers.md](design/markers.md)
- **Effects** — an ordered, non-destructive stack: Drop Shadow, Gaussian Blur,
  Color Adjust and Tint filter the content; Fill and Stroke paint the node's own
  outline over it. See [effects.md](design/effects.md)
- **Global colors** — named document swatches referenced by id, so editing one
  re-tints every use live. See [global-colors.md](design/global-colors.md)
- **New shape defaults** — the paint every newly drawn shape starts with, edited
  in the Appearance panel while nothing is selected and kept across sessions.
  "Use as new shape defaults" (Appearance header, selection context menu,
  command palette) copies a selected shape's paint into them; markers come along
  only from a line or a path, and paints that name something document-scoped (a
  global colour, an image pattern) are not restored on the next load.

## Content

- **Raster images** placed from the File menu, the canvas context menu or a drop,
  embedded as document assets; the **Assets panel** lists, re-places and prunes them.
- **Text** — auto-width point text or fixed-width area text, edited in place,
  with CJK wrapping and stored measured bounds.

## Scripting

- A one-shot drawing **DSL** running in a sandboxed Web Worker, applied as a
  single undo step.
- **Parametric generators** (experimental) — built-in Star, Gear, Spiral, Flower,
  Arrow, Sector and Moon with on-canvas parameter knobs, plus document-local
  generator scripts, which stay disabled until the user enables them.

## Canvas and workspace

- **Snapping** to shape edges and centers, equal spacing, the grid and guides.
- **Rulers and guides**, counted from the active frame or the document origin;
  guides are persisted and undoable. See
  [rulers-and-guides.md](design/rulers-and-guides.md)
- Pan, zoom, optional canvas rotation, display-only view flips, and fit to
  content / selection / frame.
- A live **status bar**: pointer readout, tool hints, and interaction numbers.
- **Pen and touch roles** — the pen draws while the finger navigates, with palm
  rejection and two/three-finger tap undo/redo. See
  [pen-and-touch.md](reference/pen-and-touch.md) and
  [drag-and-drop.md](reference/drag-and-drop.md)
- **Dockable panels**, Preferences, About, a fullscreen toggle, and a debug
  project inspector.
- Rendering cost: [render-performance.md](reference/render-performance.md)

## Commands and menus

One command registry drives keyboard shortcuts, the File menu, context menus and
the command palette (Ctrl/⌘+K), so every action is reachable from all of them.

## Files and export

- New, Open, Save / Save As — the compact binary `.vinegar` container by
  default, or `.vinegar.json` text for the same file — plus SVG import, image
  placement, PNG / JPEG / WebP and SVG export including per-frame and
  all-frames, and a built-in demo document that is itself an ordinary
  `.vinegar.json` save file.
- **System clipboard**: copied vectors mirror as SVG carrying the full node
  payload in `<metadata>` (a base64'd container), so a paste into another
  Vinegar tab keeps effects,
  scripts, assets and global colours. Both the native `paste` event and the Paste
  command go through one path — which is what lets an iPad paste at all, since
  iOS Safari fires no paste event outside a text field.
- **Document identity** drives the tab title and every suggested filename; the
  File System Access API keeps the chosen file where available, a download
  elsewhere. There is no recent-files list.
- **Recovery autosave** to IndexedDB (as container bytes), offered for restore
  after a reload or crash.

## SVG interoperability

Vinegar uses Canvas 2D and its own document model as the source of truth.
SVG import and export are **best-effort interchange features**, not a goal of
full SVG specification coverage or lossless round-tripping.

- Import (Paper.js) converts shapes, paths, compound paths, groups/layers,
  transforms, clipping groups, solid paints, basic linear/radial gradients,
  opacity, blend modes and stroke styles into editable nodes.
- SVG text, embedded images, patterns and filters may be omitted or lose
  appearance on import; imported gradients are pinned to the artwork's own
  coordinates.
- Export covers vector geometry, text, embedded images, gradients, clipping
  masks, brush outlines, blend modes and the supported effect stack. Pattern,
  filter and blend rendering can still vary between SVG viewers.

For appearance-critical exchange, use raster export. For editable exchange,
expect to inspect and adjust the result.
