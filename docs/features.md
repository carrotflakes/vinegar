# Feature reference

The detailed, developer-facing catalogue of what Vinegar does.
[README.md](../README.md) keeps only a short user-facing summary; this file is the full list, and links out to the per-feature design notes in this folder.

## Tools

- Tools: Select, Edit Nodes, Rectangle, Ellipse, Line, **Pen (Bézier)**, **Brush** (pressure / variable width), **Eraser**, Pencil (freehand), **Bucket Fill**, Text, Frame
- Pencil: freehand strokes are simplified and smoothed into an editable Bézier path (tweak it with the Node tool); end near the start to close it. Live smoothing strength is adjustable in the tool options (like the brush stabilizer)
- Brush: pen-pressure capture with adjustable size, pressure curve, stabilizer and taper; strokes remain editable vector centerlines with a derived variable-width envelope, or can be converted to ordinary filled paths.
  Consecutive strokes collect in an active drawing group. See [brush-strokes.md](brush-strokes.md)
- Eraser: split or trim Brush strokes with a vector centerline eraser while preserving the surviving Bézier geometry and width profile
- **Bucket Fill**: click an enclosed empty region to fill it with the current fill color — detected **vectorially** (no raster tracing), with an adjustable **gap-closing** tolerance for not-quite-closed line art; the fill lands as an ordinary editable even-odd path *below* the surrounding strokes.
  Clicking a filled shape or image treats it as the region's background: the fill spreads up to its edges and the strokes drawn on top, and is inserted directly above it — paint a background, draw line art, fill in between.
  An optional **"Fill to stroke centers"** mode stops fills at stroke/brush centerlines so adjacent fills stay seamless if the line art changes later. See [bucket-fill.md](bucket-fill.md)
- Pen tool: click for corner anchors, click-drag for smooth anchors; click the first anchor to close, or Enter / double-click to finish, Esc to cancel; click an endpoint of an existing open path to continue it

## Editing geometry

- Node editing: cusp, smooth, and symmetric anchor types with distinct on-canvas markers; drag anchors and control handles (Alt breaks the linkage into a cusp), click a segment to insert an anchor (curve-preserving), double-click an anchor to toggle smooth ↔ corner (handles removed), Delete to remove an anchor; Brush anchors use the same editing model; path children remain node-editable inside a compound path; open/close a path via the properties panel. See [anchor-types.md](anchor-types.md)
- Move, resize (8 handles), **rotate** (rotation handle; Shift snaps to 15°) — all driven by per-node **affine matrices**, so rotated/nested resize is exact
- Rectangles support one shared **corner radius** for all four corners, editable numerically or with an on-canvas control and preserved across export/geometry operations
- **Movable rotation centers** (transform origin) per shape and group; a transient pivot for multi-selection
- Multi-select (shift-click & marquee)
- Copy / cut / paste / duplicate (groups stay grouped on paste; **Paste here** from the canvas context menu)
- Numeric **X / Y / W / H** editing, **align & distribute** buttons
- Arrange: bring to front / send to back
- Undo / redo, plus a **History panel** that can jump directly to any retained undo/redo state and inspect the stored history entry; the retained step limit is configurable in Preferences. See [undo-history.md](undo-history.md)

## Structure

- **Group / ungroup**, including **nested groups**; grouped shapes select together
- **Clipping masks**: use the frontmost closed vector shape to clip a group; nested masks work in Canvas, PNG and SVG output and can be released for editing
- **Compound paths**: own real, nested layer nodes for their closed source shapes, paint them through one shared even-odd appearance, allow path-anchor and hide/reorder editing, and release back to the original shape types. See [compound-path-nodes.md](compound-path-nodes.md)
- **Layers panel**: tree view of groups (collapse, show/hide, lock/unlock), z-order list, click to select, drag to reorder (across parents), double-click to rename, and **hovering a row outlines that node on the canvas** — a shape along its real geometry, a group/frame by its box, with a short entry pulse and an edge arrow pointing at it when it is off-screen
- **Layers panel selection**: Shift+click takes a contiguous range and Ctrl/Cmd+click toggles one row (the on-screen Shift toggle counts as Shift, so ranges work on touch) (locked and hidden rows stay out of a range); ↑/↓ walk the rows of the focused list and ←/→ fold a container, dragging a selected row moves the whole selection in one undo step, and a selection made on the canvas scrolls its row into view, unfolding whatever hid it. `Enter` selects the contents of the selected containers, `Shift+Enter` their parent

## Path operations

- **Boolean operations**: union, subtract, intersect, exclude (Paper.js; curve-preserving — the result is a node-editable compound Bézier); **Divide** splits overlapping shapes into their distinct faces, each styled by the frontmost covering shape and grouped
- **Path ops**: **Join** welds selected open paths' nearby endpoints into continuous contours (closing a contour whose ends meet); **Cut** breaks a contour at selected anchors (the exact inverse of Join); **Combine** gathers several paths into one multi-contour path without moving anything — the container open contours otherwise lack, since a compound path only takes closed children; **Split subpaths** breaks a multi-contour path back into one path per contour, inside a group that preserves the original's compositing; and one-shot **Simplify / Smooth / Flatten / Reverse** cleanup. See [path-commands.md](path-commands.md)
- **Convert to path** turns rectangles (including rounded corners), ellipses, lines, Brush strokes and compound paths into ordinary editable paths while preserving their appearance
- **Outline stroke**: convert a shape's stroke into a filled path (`clipper-lib`)

Related design notes: [path-unification.md](path-unification.md), [path-modifiers.md](path-modifiers.md).

## Appearance

- **Paint model** for fill/stroke: solid colors with **per-color alpha** and **gradients** (linear & radial, with a stop editor), plus raster **patterns** with tile / fill / fit / stretch placement modes, scale, offset and (for tiles) rotation — rendered on Canvas and exported to SVG using embedded images and `<pattern>`.
  Swatch popover with preset palette, recent colors, saved swatches, hex input, "none" and the **eyedropper**.
- Stroke width plus **dash pattern/offset, cap, join and inside/center/outside alignment** (closed vectors and text), opacity, and per-node **blend modes** (multiply, screen, overlay, … — shapes and groups)
- **Effects**: non-destructive, Illustrator-style **ordered effect stack** on any node (shape / group / instance) — **Drop Shadow**, **Gaussian Blur**, **Color Adjust** (brightness / contrast / saturation / hue) and **Color Overlay** (solid tint masked by the content's alpha), applied after content but before opacity/blend; the length-based effects (shadow, blur) scale with the transform and zoom, the color effects are unitless; rendered on Canvas, exported to SVG (`<filter>`/`feColorMatrix`) and raster images, with export bounds grown so shadows/blur aren't cropped
- **Global colors** (document color swatches): named solid colors stored on the document that a fill/stroke can *reference* by id — edit the color once and every use re-tints live. The **Global colors panel** creates a color from the selection, renames, applies it to the selection's fill/stroke, and deletes it (baking every reference back to its concrete color first, so nothing dangles). The color popover can link a paint to a global color or unlink it; SVG export bakes references to concrete colors. See [global-colors.md](global-colors.md)

## Reuse and content

- **Symbols** (reusable components): create from a selection, place instances (the panel's + button or drag a row onto the canvas), edit in an isolated view (double-click an instance), detach / rename / delete
- **Frames** (formerly artboards): real **container nodes** in the scene tree — a frame owns its children, has its own local coordinate space (an SVG-like viewport), a background color (transparent frames show an editor-only checkerboard) and an optional **Clip content** toggle.
  Create/move/resize with the Frame tool (resizing changes the content box only, so contents stay put); frames live at the top level and never nest.
  Dragging a selection over a frame **re-homes it into that frame** (world position preserved, same undo step; Cmd/Ctrl on release opts out), and a frame is a selection boundary — its contents are picked directly while the frame itself is grabbed by its border or the Layers panel.
  There is no separate frames panel — frames are nodes, so the Layers tree lists them and their z-order there is the export order; fit-to-frame and per-frame PNG/SVG export sit in the selection context menu, plus all-frames PNG export.
- **Raster images**: place via File ▸ Place image…, the canvas context menu, or drag & drop; images select/move/resize/rotate and take opacity/blend like any shape; embedded in the file as document assets.
  Image properties can lock the aspect ratio, restore the asset's natural pixel size, or restore its natural aspect ratio.
  The **Assets panel** (hidden by default; add it from the dock's panel menu) lists embedded assets with a thumbnail and reference count, places an asset back onto the canvas without re-importing (+ button or drag a row), and can delete unused ones.
- **Text**: click for auto-width point text or drag for fixed-width wrapping text; in-place editing supports newlines, CJK wrapping, rotation, font/style controls, saved measured bounds, and Canvas/SVG/raster output

## Scripting

- **Scripting**: a one-shot drawing DSL that runs in a sandboxed Web Worker and applies its changes in a single undo step; can create shapes and read/edit existing ones (open via the "Script" button in the app bar)
- **Parametric generators (experimental)**: insert the built-in Star, Gear, Spiral, Flower and Moon generators, or author document-local generator scripts whose numeric parameters rebuild editable Bézier geometry. Copying a generated shape carries its script along, so pasting into another document keeps the shape re-tunable (a script arriving from a document whose generators were never approved re-arms the consent gate); a link that resolves to no script at all pastes as a plain path.
  Imported document scripts stay disabled until the user explicitly enables them and run in a watchdog-protected Web Worker.

## Canvas and workspace

- **Snapping**: edges/centers snap to other shapes (magenta alignment guides), equal-spacing distribution between neighbours (spacing markers), and an optional grid (adjustable size).
  Object/grid/guide point snapping works while creating shapes and frames, resizing, and editing Pen vertices; full edge/center and equal-spacing snapping applies while moving — toggle "Snap" / "Grid" in the status bar.
- **Rulers and guides**: rulers along the top/left edges label document units and count from the **active frame** (which follows selection and frame creation, never panning — Illustrator's artboard rulers) or from the document origin, per the "Ruler origin" preference; drag out of a ruler for a persistent guide, drag it to move, drop it back on or beyond a ruler (or press Delete) to remove it.
  Guides are saved with the document, are undoable like any edit, snap alongside objects and the grid, and can be hidden or locked from the "Snap" status-bar menu. See [rulers-and-guides.md](rulers-and-guides.md)
- Pan (Space + drag, or middle mouse), zoom (Ctrl/⌘ + wheel), and optionally rotate the canvas from the zoom menu or with a two-finger twist (with 90° snapping); the view can also be flipped horizontally, reset, or fitted to all content (Shift+1), the selection (Shift+2), or the selected frame
- Live **status bar**: pointer readout, per-tool hints, selection info, and live numbers during interactions (W×H while creating, ΔX/ΔY while moving, angle while rotating, new size while resizing)
- **Responsive / touch** layout: icon-only toolbar rail, slide-in panels, enlarged hit targets for coarse pointers, pinch-to-zoom & two-finger pan, on-screen Shift/Alt modifier bar. Drag conventions: [drag-and-drop.md](drag-and-drop.md)
- **Pen and touch roles** (tablets): the pen draws while the finger navigates. Palm rejection ignores touch while the pen is on the glass and briefly after it lifts, a **two-finger tap undoes** and a **three-finger tap redoes**, and a hovering pen previews the brush/eraser tip. Finger drawing is a preference that switches itself off the first time a pen is used, after which a one-finger drag pans instead of painting. See [pen-and-touch.md](pen-and-touch.md)
- **Dockable panels**: panel tabs can be reordered, moved between vertically resizable groups, split into new groups, closed and restored from the add-panel menu; the layout is saved locally and can be reset from Preferences
- **Preferences**: light / dark / system theme, canvas rotation and 90° snapping, ruler origin, finger drawing, recovery autosave interval, undo-history limit, and dock-layout reset
- Browser fullscreen toggle
- Debug **project inspector** (app bar ▸ Inspect): searchable JSON tree of the whole store

Rendering cost notes: [render-performance.md](render-performance.md).

## Commands and menus

- **Command registry**: one source of truth for actions, driving keyboard shortcuts, the File menu, context menus and the **command palette** (Ctrl/⌘+K — shortcuts are discoverable there and in the menus)
- **Menus**: the File menu and canvas/layers **context menus** share one data model and Floating UI-based renderer, with submenus, keyboard navigation + typeahead, shortcut hints and flip/shift overflow handling

## Files and export

- File: New, Open, Save / Save As (`.vinegar.json`), import SVG, place raster images, export PNG/JPEG/WebP with range, size, background and quality controls, and export SVG; the built-in Demo can be opened from the command palette
- **System clipboard integration**: copy/cut mirrors selected vectors as SVG for pasting into other tabs or applications; pasted external SVG is imported as editable vectors, pasted bitmap data becomes an image, and same-tab Vinegar paste uses its higher-fidelity in-memory node payload. The copied SVG also embeds that payload in its `<metadata>`, so pasting into another Vinegar tab (or another document) keeps effects, generator links and their scripts, image assets and global colours instead of flattened geometry; such a paste lands centered in the view (the copy's own coordinates mean nothing in another document), and a payload the destination cannot take — an instance whose symbol it lacks — falls back to the SVG
- **Document identity**: the document name is edited in the middle of the app bar and drives the browser tab title, the suggested save filename and every export filename. Where the browser supports the File System Access API (Chromium today), Open and Save As remember the chosen file so ⌘/Ctrl+S overwrites it in place; elsewhere both fall back to a download named after the document.
  There is no recent-files list; see [recent-files.md](recent-files.md) for the shelved design.
- **Browser recovery autosave**: dirty documents are saved locally in IndexedDB and, after a reload/crash, offered for restore on next launch (Cancel discards); progress is reported in the status bar

## SVG interoperability

Vinegar uses Canvas 2D and its own document model as the source of truth.
SVG import and export are **best-effort interchange features**, not a goal of full SVG specification coverage or lossless round-tripping.

- Import uses Paper.js and converts supported shapes, paths, compound paths, groups/layers, transforms, clipping groups, solid paints, basic linear/radial gradients, opacity, blend modes and stroke dash/cap/join styles into editable Vinegar nodes
- SVG text, embedded images, patterns, filters and other unsupported SVG constructs may be omitted or lose appearance during import; gradient geometry is reduced to Vinegar's angle/bounds-relative model
- Export covers Vinegar vector geometry, text, embedded images, gradients, clipping masks, Brush outlines, blend modes and the supported effect stack
- Raster pattern paints export as SVG `<pattern>` elements with embedded images; pattern, filter and blend rendering can still vary between SVG viewers

For appearance-critical exchange, use raster export.
For editable exchange, expect to inspect and adjust the imported or exported result.
