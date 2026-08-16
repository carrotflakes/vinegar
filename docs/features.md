# Feature reference

The detailed, developer-facing catalogue of what Vinegar does.
[README.md](../README.md) keeps only a short user-facing summary; this file is the full list, and links out to the per-feature design notes in this folder.

## Tools

- Tools: Select, Edit Nodes, Rectangle, Ellipse, Line, **Pen (Bézier)**, **Brush** (pressure / variable width), **Eraser**, Pencil (freehand), **Bucket Fill**, Text, Frame
- Pencil: freehand strokes are simplified and smoothed into an editable Bézier path (tweak it with the Node tool); end near the start to close it (at the same distance the pen closes a draft, enlarged for touch) — the start point rings and the loop previews its closing edge and the current fill while the release would close it, and a closed stroke keeps that fill where an open one is a line with none. The **Close** option chooses when that happens: *Never*, *Near start* (the default), or *Always* — the last closes every stroke wherever it is lifted, for drawing filled regions in a row without landing back on the start each time. The point a stroke begins at snaps to guides and the grid (not to other shapes — a freehand start should only meet references you placed on purpose); nothing after it snaps. Live smoothing strength and the commit-time simplify tolerance are adjustable in the tool options (both shared with the brush). Start a stroke near an endpoint of a **selected** open path to continue (extend) it instead of drawing a new one; the same Close rule applies to the extension, so coming back to the path's other end closes it (an extension never overwrites a fill the path already has)
- Brush: pen-pressure capture with adjustable size, pressure curve, stabilizer and taper; strokes remain editable vector centerlines with a derived variable-width envelope, or can be converted to ordinary filled paths.
  Consecutive strokes collect in an active drawing group. See [brush-strokes.md](brush-strokes.md)
- Eraser: split or trim Brush strokes with a vector centerline eraser while preserving the surviving Bézier geometry and width profile
- **Bucket Fill**: click an enclosed empty region to fill it with the current fill color — detected **vectorially** (no raster tracing), with an adjustable **gap-closing** tolerance for not-quite-closed line art; the fill lands as an ordinary editable even-odd path *below* the surrounding strokes.
  Clicking a filled shape or image treats it as the region's background: the fill spreads up to its edges and the strokes drawn on top, and is inserted directly above it — paint a background, draw line art, fill in between.
  An optional **"Fill to stroke centers"** mode stops fills at stroke/brush centerlines so adjacent fills stay seamless if the line art changes later. See [bucket-fill.md](bucket-fill.md)
- Pen tool: click for corner anchors, click-drag for smooth anchors (**Alt** while dragging breaks the linkage — the outgoing handle moves alone, giving a cusp); click the first anchor to close (the rubber band previews the closing segment and the anchor rings when it is in reach), or Enter / Esc / double-click to finish, Backspace / ⌘Z to step back one anchor. Click an endpoint of an existing open path to continue it (the endpoint rings when it is in reach, as it does for the pencil) — dragging then pulls only the new outgoing handle, leaving the segment already drawn alone. Anchors snap to the draft's own anchors as well as to the document; a **Done / Close / Undo / Discard** bar appears while a path is in progress, so none of this needs a keyboard

## Editing geometry

- Node editing: cusp, smooth, and symmetric anchor types with distinct on-canvas markers; drag anchors and control handles (Shift constrains either to 45°, Alt breaks the linkage into a cusp), click a segment to insert an anchor (curve-preserving), double-click an anchor to toggle smooth ↔ corner (handles removed), marquee or Shift-click to select several anchors, ⌘A to take them all, Delete to remove every selected anchor (a neighbour stays selected, so presses chain), Escape to drop the anchor selection without leaving the shape; right-clicking an anchor offers its type, cut and delete. Brush anchors use the same editing model; path children remain node-editable inside a compound path; open/close a path via the properties panel. See [anchor-types.md](anchor-types.md)
- Handles are drawn — and can be grabbed — only around the selected anchors: their own, plus the neighbouring handles facing them, so both sides of a segment touching the selection are adjustable while the rest of the path stays legible. A **Show all handles** preference restores the draw-everything behaviour; rendering and hit-testing read the same set, so an unseen handle is never picked up by accident
- Move, resize (8 handles), **rotate** (rotation handle; Shift snaps to 15°) — all driven by per-node **affine matrices**, so rotated/nested resize is exact. A move only starts once the pointer leaves the click slop, so pressing a shape to select it never nudges it; **Shift** locks the drag to the leading axis (and outranks snapping there) and **Alt** drops a copy in place and drags that instead, leaving the original behind — duplicate and move land as one undo step. The on-screen modifier bar counts as Shift/Alt, so both work on touch
- Rectangles support one shared **corner radius** for all four corners, editable numerically or with an on-canvas knob (the same orange diamond used for generator parameters) and preserved across export/geometry operations
- **Movable rotation centers** (transform origin) per shape and group; a transient pivot for multi-selection
- **Hovering with the Select tool outlines what a click would take** — the leaf along its real geometry, the enclosing group by its box (so grouped art says so before you click it) — using the same accent as the Layers-panel hover. Anything already selected is left to its selection frame. A **locked** node under the pointer is outlined too, in a muted dashed line with a padlock badge: the click passes straight through it, and that is otherwise indistinguishable from having missed
- Multi-select (shift-click & marquee). Shift-clicking a selected object drops it from the selection and nothing else — it never becomes a drag of what remains — while clicking (without dragging) one member of a multi-selection singles that member out on release
- Arrow keys nudge by one unit (Shift: ten) — the selected anchors in the node tool, the selection otherwise; a run of presses is one undo step
- Copy / cut / paste / duplicate (groups stay grouped on paste; **Paste here** from the canvas context menu)
- Numeric **X / Y / W / H** editing, **align & distribute** buttons
- Arrange: bring to front / send to back
- Undo / redo, plus a **History panel** that can jump directly to any retained undo/redo state and inspect the stored history entry; the retained step limit is configurable in Preferences. See [undo-history.md](undo-history.md)

## Structure

- **Group / ungroup**, including **nested groups**; grouped shapes select together
- **Clipping masks**: use the frontmost closed vector shape to clip a group; nested masks work in Canvas, PNG and SVG output and can be released for editing
- **Compound paths**: own real, nested layer nodes for their closed source shapes, paint them through one shared even-odd appearance, allow path-anchor and hide/reorder editing, and release back to the original shape types. See [compound-path-nodes.md](compound-path-nodes.md)
- **Layers panel**: tree view of groups (collapse — with a header menu for *Expand all* / *Collapse all* / *Collapse others*, which folds everything except the way down to the selection — show/hide, lock/unlock), z-order list, click to select, drag to reorder (across parents), double-click to rename, right-click (or, on touch, a rightward swipe on the row) for its context menu, and **hovering a row outlines that node on the canvas** — a shape along its real geometry, a group/frame by its box, with a short entry pulse and an edge arrow pointing at it when it is off-screen
- **Layers panel selection**: Shift+click takes a contiguous range and Ctrl/Cmd+click toggles one row (locked and hidden rows stay out of a range). Touch has neither key, so the on-screen Shift toggle counts as Shift, and the title bar's **multi-select** toggle makes a plain tap add or remove a row for as long as it is on; ↑/↓ walk the rows of the focused list and ←/→ fold a container, dragging a selected row moves the whole selection in one undo step, and a selection made on the canvas scrolls its row into view, unfolding whatever hid it. `Enter` selects the contents of the selected containers, `Shift+Enter` their parent

## Path operations

- **Boolean operations**: union, subtract, intersect, exclude (Paper.js; curve-preserving — the result is a node-editable compound Bézier); **Divide** splits overlapping shapes into their distinct faces, each styled by the frontmost covering shape and grouped
- **Path ops**: **Join** welds selected open paths' nearby endpoints into continuous contours (closing a contour whose ends meet); **Cut** breaks a contour at selected anchors (the exact inverse of Join); **Combine** gathers several paths (rects / ellipses / lines convert on the way in, and selecting a group combines its contents) into one multi-contour path without moving anything — the container open contours otherwise lack, since a compound path only takes closed children; **Split subpaths** breaks a multi-contour path back into one path per contour, inside a group that preserves the original's compositing; and one-shot **Simplify / Smooth / Flatten / Reverse** cleanup. See [path-commands.md](path-commands.md)
- **Convert to path** turns rectangles (including rounded corners), ellipses, lines, Brush strokes and compound paths into ordinary editable paths while preserving their appearance
- **Outline stroke**: convert a shape's stroke into a filled path (`clipper-lib`)
- **Path modifiers** — a non-destructive, re-editable stack (Simplify, Flatten,
  Offset, Outline, Smooth, Reverse) on paths *and* on rectangles, ellipses and
  lines; the shape keeps its own editable fields (a rect stays a rect with a
  corner radius), and *Apply* bakes the stack, converting a primitive to a path

Related design notes: [path-unification.md](path-unification.md), [path-modifiers.md](path-modifiers.md).

## Appearance

- **Paint model** for fill/stroke: solid colors with **per-color alpha** and **gradients** (linear, radial and conic, placed with an on-canvas gradient tool: axis, ellipse and focal handles, stop chips with blend midpoints, pad/repeat/reflect spread and sRGB or OkLab blending), **freeform gradients**
  (scattered colour points blended by inverse-distance or radial-basis
  interpolation, dragged on the canvas or in the color popover's pad), plus raster **patterns** with tile / fill / fit / stretch placement modes, scale, offset and (for tiles) rotation — rendered on Canvas and exported to SVG using embedded images and `<pattern>`.
  Swatch popover with preset palette, recent colors, saved swatches, hex input, "none" and the **eyedropper**.
- Stroke width plus **dash pattern/offset, cap, join and inside/center/outside alignment** (closed vectors and text), opacity, and per-node **blend modes** (multiply, screen, overlay, … — shapes and groups)
- **End markers** on lines and open paths: arrow, triangle, circle, square, diamond and bar, each solid or hollow and flippable, sized as a multiple of the stroke width and painted with the stroke paint. Every open end of every subpath is marked; markers can be preset for the next line/path drawn, follow the modifier stack and export to SVG as real geometry. See [markers.md](markers.md)
- **Effects**: non-destructive, Illustrator-style **ordered effect stack** on any node (shape / group / instance), applied after content but before opacity/blend. Pixel effects — **Drop Shadow**, **Gaussian Blur**, **Color Adjust** (brightness / contrast / saturation / hue) and **Tint** (a solid colour mixed into the content's own alpha) — filter what the stack has produced so far. Geometry effects — **Fill** and **Stroke** — paint the node's *own outline* over it, each with a full paint (solid / gradient / freeform / pattern / global color), its own **blend mode** against the artwork below it in the stack, and, for a stroke, its own width, inside/center/outside alignment, cap and join; so a shape can carry several outlines at once. Geometry effects are inert on nodes with no outline (groups, frames, images, live text) — which is why Tint stays: it is the colour *filter* to Fill's colour *source*, so it can recolour an image, live text or a whole group, and tint a blur's soft halo without stamping a hard edge over it. Length-based effects (shadow, blur, stroke width) scale with the transform and zoom, the color effects are unitless; rendered on Canvas, exported to SVG (`<filter>`/`feColorMatrix`, plus sibling elements for Fill/Stroke) and raster images, with export bounds grown so shadows, blur and wide outside strokes aren't cropped. See [effects.md](effects.md)
- **Global colors** (document color swatches): named solid colors stored on the document that a fill/stroke can *reference* by id — edit the color once and every use re-tints live. The **Global colors panel** creates a color from the selection, renames, applies it to the selection's fill/stroke, and deletes it (baking every reference back to its concrete color first, so nothing dangles). The color popover can link a paint to a global color or unlink it; SVG export bakes references to concrete colors. See [global-colors.md](global-colors.md)

## Reuse and content

- **Symbols** (reusable components): create from a selection, place instances (the panel's + button or drag a row onto the canvas), edit in an isolated view (double-click an instance), detach / rename / delete
- **Frames**: real **container nodes** in the scene tree — a frame owns its children, has its own local coordinate space (an SVG-like viewport), a background color (transparent frames show an editor-only checkerboard) and an optional **Clip content** toggle.
  Create/move/resize with the Frame tool (resizing changes the content box only, so contents stay put); frames live at the top level and never nest.
  Dragging a selection over a frame **re-homes it into that frame** (world position preserved, same undo step; Cmd/Ctrl on release opts out), and a frame is a selection boundary — its contents are picked directly while the frame itself is grabbed by its border or the Layers panel.
  There is no separate frames panel — frames are nodes, so the Layers tree lists them and their z-order there is the export order; fit-to-frame and per-frame PNG/SVG export sit in the selection context menu, plus all-frames PNG export.
- **Raster images**: place via File ▸ Place image…, the canvas context menu, or drag & drop; images select/move/resize/rotate and take opacity/blend like any shape; embedded in the file as document assets.
  Image properties can lock the aspect ratio, restore the asset's natural pixel size, or restore its natural aspect ratio.
  The **Assets panel** (hidden by default; add it from the dock's panel menu) lists embedded assets with a thumbnail and reference count, places an asset back onto the canvas without re-importing (+ button or drag a row), and can delete unused ones.
- **Text**: click for auto-width point text or drag for fixed-width wrapping text; in-place editing supports newlines, CJK wrapping, rotation, font/style controls, saved measured bounds, and Canvas/SVG/raster output

## Scripting

- **Scripting**: a one-shot drawing DSL that runs in a sandboxed Web Worker and applies its changes in a single undo step; can create shapes and read/edit existing ones (open via the "Script" button in the app bar)
- **Parametric generators (experimental)**: insert the built-in Star, Gear, Spiral, Flower, Arrow, Sector and Moon generators from the toolbar's generator flyout — click a thumbnail to drop it at the canvas centre, or drag it onto the canvas to place it where you release — or author document-local generator scripts whose numeric parameters rebuild editable Bézier geometry. Copying a generated shape carries its script along, so pasting into another document keeps the shape re-tunable (a script arriving from a document whose generators were never approved re-arms the consent gate); a link that resolves to no script at all pastes as a plain path.
  Imported document scripts stay disabled until the user explicitly enables them and run in a watchdog-protected Web Worker.
  Selecting a built-in generator node also shows its parameters as on-canvas knobs — the orange diamonds shared with the rectangle's corner radius — drag one to retune the shape in place (radius, tooth depth, sector angles, moon phase, …) as a single undo step. Document scripts have no knobs yet and stay panel-only.

## Canvas and workspace

- **Snapping**: edges/centers snap to other shapes (magenta alignment guides), equal-spacing distribution (spacing markers — centering in the gap between two neighbours, or repeating a gap that already exists in the row, which continues an evenly spaced row past its end), and an optional grid (adjustable size).
  Object/grid/guide point snapping works while creating shapes and frames, resizing, and editing Pen vertices; full edge/center and equal-spacing snapping applies while moving — toggle "Snap" / "Grid" in the status bar.
- **Rulers and guides**: rulers along the top/left edges label document units and count from the **active frame** (which follows selection and frame creation, never panning — Illustrator's artboard rulers) or from the document origin, per the "Ruler origin" preference; drag out of a ruler for a persistent guide, drag it to move, drop it back on or beyond a ruler (or press Delete) to remove it.
  Guides are saved with the document, are undoable like any edit, snap alongside objects and the grid, and can be hidden or locked from the "Snap" status-bar menu. See [rulers-and-guides.md](rulers-and-guides.md)
- Pan (Space + drag, or middle mouse), zoom (Ctrl/⌘ + wheel), and optionally rotate the canvas from the zoom menu or with a two-finger twist (with 90° snapping); the **zoom menu** also holds an exact zoom percentage, ±90° rotation and the display-only **view flips** (horizontal Shift+F, vertical), which mirror what you see without touching the document — a mirrored view is flagged in the zoom readout. The view can also be reset, or fitted to all content (Shift+1), the selection (Shift+2), or the selected frame
- Live **status bar**: pointer readout, per-tool hints, selection info, and live numbers during interactions (W×H while creating, ΔX/ΔY while moving, angle while rotating, new size while resizing)
- **Responsive / touch** layout: icon-only toolbar rail, slide-in panels, enlarged hit targets for coarse pointers, pinch-to-zoom & two-finger pan, on-screen Shift/Alt modifier bar. Drag conventions: [drag-and-drop.md](drag-and-drop.md)
- **Pen and touch roles** (tablets): the pen draws while the finger navigates. Palm rejection ignores touch while the pen is on the glass and briefly after it lifts, a **two-finger tap undoes** and a **three-finger tap redoes**, and a hovering pen previews the brush/eraser tip. Finger drawing is a preference that switches itself off the first time a pen is used, after which a one-finger drag pans instead of painting. See [pen-and-touch.md](pen-and-touch.md)
- **Dockable panels**: panel tabs can be reordered, moved between vertically resizable groups, split into new groups, closed and restored from the add-panel menu; the layout is saved locally and can be reset from Preferences
- **Preferences**: a sidebar of categories (Interface, Canvas & Editing, Files & Recovery, Advanced, About) over one continuous scrolling panel — light / dark / system theme, canvas rotation and 90° snapping, ruler origin, finger drawing, handle visibility, recovery autosave interval and undo-history limit, with "Reset to defaults" and "Reset layout" in the footer
- **About**: the Preferences "About" category shows the app version, the git commit the bundle was built from (`-dirty` when the tree was not clean) and the build time, plus a link to the GitHub repository (the commit itself links to its GitHub page when the tree was clean) and a button that copies all of it with the user agent for bug reports. The values are injected at build time by `define` in `vite.config.ts` and read through `src/buildInfo.ts`
- Browser fullscreen toggle
- Debug **project inspector** (app bar ▸ Inspect): searchable JSON tree of the whole store

Rendering cost notes: [render-performance.md](render-performance.md).

## Commands and menus

- **Command registry**: one source of truth for actions, driving keyboard shortcuts, the File menu, context menus and the **command palette** (Ctrl/⌘+K — shortcuts are discoverable there and in the menus)
- **Menus**: the File menu and canvas/layers **context menus** share one data model and Floating UI-based renderer, with submenus, keyboard navigation + typeahead, shortcut hints and flip/shift overflow handling

## Files and export

- File: New, Open, Save / Save As (`.vinegar.json`), import SVG, place raster images, export PNG/JPEG/WebP with range, size, background and quality controls, and export SVG; the built-in Demo can be opened from the command palette — it is a five-frame feature tour (cover, shapes & paint, structure, effects & blending, generators & path modifiers) shipped as an ordinary `.vinegar.json` file (`src/demo/demo.vinegar.json`), so it is edited by opening it, changing it and saving over that file, and it opens fitted to all its frames
- **System clipboard integration**: copy/cut mirrors selected vectors as SVG for pasting into other tabs or applications; pasted external SVG is imported as editable vectors, pasted bitmap data becomes an image, and same-tab Vinegar paste uses its higher-fidelity in-memory node payload. The copied SVG also embeds that payload in its `<metadata>`, so pasting into another Vinegar tab (or another document) keeps effects, generator links and their scripts, image assets and global colours instead of flattened geometry; such a paste lands centered in the view (the copy's own coordinates mean nothing in another document), and a payload the destination cannot take — an instance whose symbol it lacks — falls back to the SVG.
  Both routes into a paste — the native `paste` event and the Paste command in the menus and palette — go through `src/commands/pasteClipboard.ts`, so they reach the same decision. The command reads the system clipboard itself through `navigator.clipboard.read()`, which is how an iPad pastes at all: iOS Safari dispatches no `paste` event while focus sits outside a text field, so ⌘V cannot reach the canvas there (its paste confirmation appears only while ⌘ is held and withdraws on key-up, so reading eagerly from the keystroke is refused too) and the long-press menu's **Paste** is the way in. An SVG on the clipboard is imported as editable vectors whichever way it arrives — as markup or as a file — while placing an SVG *file* as an image asset stays available through the file picker and the Assets panel. A clipboard that carries a file but nothing we can turn into artwork reports that rather than doing nothing
- **Document identity**: the document name is edited in the middle of the app bar and drives the browser tab title, the suggested save filename and every export filename. Where the browser supports the File System Access API (Chromium today), Open and Save As remember the chosen file so ⌘/Ctrl+S overwrites it in place; elsewhere both fall back to a download named after the document.
  There is no recent-files list; see [recent-files.md](recent-files.md) for the shelved design.
- **Browser recovery autosave**: dirty documents are saved locally in IndexedDB and, after a reload/crash, offered for restore on next launch (Cancel discards); progress is reported in the status bar

## SVG interoperability

Vinegar uses Canvas 2D and its own document model as the source of truth.
SVG import and export are **best-effort interchange features**, not a goal of full SVG specification coverage or lossless round-tripping.

- Import uses Paper.js and converts supported shapes, paths, compound paths, groups/layers, transforms, clipping groups, solid paints, basic linear/radial gradients, opacity, blend modes and stroke dash/cap/join styles into editable Vinegar nodes
- SVG text, embedded images, patterns, filters and other unsupported SVG constructs may be omitted or lose appearance during import; imported gradients keep their placement but are pinned to the artwork's own coordinates
- Export covers Vinegar vector geometry, text, embedded images, gradients, clipping masks, Brush outlines, blend modes and the supported effect stack
- Raster pattern paints export as SVG `<pattern>` elements with embedded images; pattern, filter and blend rendering can still vary between SVG viewers

For appearance-critical exchange, use raster export.
For editable exchange, expect to inspect and adjust the imported or exported result.
