# Vinegar

Vinegar is a browser-based vector graphics editor for precise drawing and illustration, with Bézier editing, pressure-sensitive brushes, reusable symbols, artboards, and flexible export.

## Stack

- React 19 + TypeScript + Vite
- Zustand for state (with undo/redo history)
- Canvas 2D rendering (no SVG/WebGL)
- Paper.js for boolean path operations; `clipper-lib` for stroke outlining
- `react-icons` (Lucide) for the toolbar; `@floating-ui/react-dom` for popovers
- Package manager: **pnpm**

## Getting started

```bash
pnpm install
pnpm dev        # start the dev server (http://localhost:5173)
pnpm build      # typecheck + production build
pnpm typecheck  # types only
pnpm test       # node --test (model, store, persistence, import and recovery)
```

## Features

- Tools: Select, Edit Nodes, Rectangle, Ellipse, Line, **Pen (Bézier)**, **Brush** (pressure / variable width), **Eraser**, Pencil (freehand), **Bucket Fill**, Text, Artboard
- Pencil: freehand strokes are simplified and smoothed into an editable Bézier path (tweak it with the Node tool); end near the start to close it
- Brush: pen-pressure capture with adjustable size, pressure curve, stabilizer and taper; strokes remain editable vector centerlines with a derived variable-width envelope.
  Consecutive strokes collect in an active drawing group.
- Eraser: split or trim Brush strokes with a vector centerline eraser while preserving the surviving Bézier geometry and width profile
- **Bucket Fill**: click an enclosed empty region to fill it with the current fill color — detected **vectorially** (no raster tracing), with an adjustable **gap-closing** tolerance for not-quite-closed line art; the fill lands as an ordinary editable polygon *below* the surrounding strokes.
  Clicking a filled shape or image treats it as the region's background: the fill spreads up to its edges and the strokes drawn on top, and is inserted directly above it — paint a background, draw line art, fill in between.
  An optional **"Fill to stroke centers"** mode stops fills at stroke/brush centerlines so adjacent fills stay seamless if the line art changes later (see [docs/bucket-fill.md](docs/bucket-fill.md))
- Pen tool: click for corner anchors, click-drag for smooth anchors; click the first anchor to close, or Enter / double-click to finish, Esc to cancel; click an endpoint of an existing open path to continue it
- Node editing: drag anchors and control handles (Alt to break handle symmetry), click a segment to insert an anchor (curve-preserving), double-click an anchor to toggle smooth ↔ corner, Delete to remove an anchor; Brush anchors use the same editing model; open/close a path via the properties panel
- Move, resize (8 handles), **rotate** (rotation handle; Shift snaps to 15°) — all driven by per-node **affine matrices**, so rotated/nested resize is exact
- Rectangles support one shared **corner radius** for all four corners, editable numerically or with an on-canvas control and preserved across export/geometry operations
- **Movable rotation centers** (transform origin) per shape and group; a transient pivot for multi-selection
- **Group / ungroup**, including **nested groups**; grouped shapes select together
- **Clipping masks**: use the frontmost closed vector shape to clip a group; nested masks work in Canvas, PNG and SVG output and can be released for editing
- Multi-select (shift-click & marquee)
- Copy / cut / paste / duplicate (groups stay grouped on paste; **Paste here** from the canvas context menu)
- **Boolean operations**: union, subtract, intersect, exclude (Paper.js; curve-preserving — the result is a node-editable compound Bézier)
- **Compound paths**: retain closed source shapes behind one shared appearance, cut even-odd holes, and release back to the original shape types
- **Outline stroke**: convert a shape's stroke into a filled path (`clipper-lib`)
- **Paint model** for fill/stroke: solid colors with **per-color alpha** and **gradients** (linear & radial, with a stop editor), plus tiled raster **patterns** — rendered on Canvas.
  Solids and gradients export to SVG; pattern SVG export is intentionally limited (see SVG interoperability below).
  Swatch popover with preset palette, recent colors, saved swatches, hex input, "none" and the **eyedropper**.
- Stroke width plus **dash pattern/offset, cap, join and inside/center/outside alignment** (closed vectors and text), opacity, and per-node **blend modes** (multiply, screen, overlay, … — shapes and groups)
- **Effects**: non-destructive, Illustrator-style **ordered effect stack** on any node (shape / group / instance) — **Drop Shadow** and **Gaussian Blur**, applied after content but before opacity/blend, scaling with the transform and zoom; rendered on Canvas, exported to SVG (`<filter>`) and raster images, with export bounds grown so shadows/blur aren't cropped
- **Symbols** (reusable components): create from a selection, place instances (the panel's + button or drag a row onto the canvas), edit in an isolated view (double-click an instance), detach / rename / delete
- **Artboards**: non-owning frames on the infinite plane — create/move/resize with the Artboard tool, per-board PNG/SVG export and all-board PNG export
- **Raster images**: place via File ▸ Place image…, the canvas context menu, or drag & drop; images select/move/resize/rotate and take opacity/blend like any shape; embedded in the file as document assets.
  The **Assets panel** (hidden by default; add it from the dock's panel menu) lists embedded assets with a thumbnail and reference count, places an asset back onto the canvas without re-importing (+ button or drag a row), and can delete unused ones.
- **Text**: click for auto-width point text or drag for fixed-width wrapping text; in-place editing supports newlines, CJK wrapping, rotation, font/style controls, saved measured bounds, and Canvas/SVG/raster output
- Numeric **X / Y / W / H** editing, **align & distribute** buttons
- Arrange: bring to front / send to back
- **Layers panel**: tree view of groups (collapse, show/hide, lock/unlock), z-order list, click to select, drag to reorder (across parents), double-click to rename
- **Command registry**: one source of truth for actions, driving keyboard shortcuts, the File menu, context menus and the **command palette** (Ctrl/⌘+K — shortcuts are discoverable there and in the menus)
- **Context menus** on the canvas and layers panel
- **Snapping**: edges/centers snap to other shapes (magenta alignment guides), equal-spacing distribution between neighbours (spacing markers), and an optional grid (adjustable size).
  Works while moving, **drawing, resizing, and editing pen vertices** — toggle "Snap" / "Grid" in the status bar.
- **Scripting**: a one-shot drawing DSL that runs in a sandboxed Web Worker and applies its changes in a single undo step; can create shapes and read/edit existing ones (open via the "Script" button in the app bar)
- **Parametric generators (experimental)**: insert the built-in Star generator or author document-local generator scripts whose numeric parameters rebuild editable Bézier geometry.
  Imported document scripts stay disabled until the user explicitly enables them and run in a watchdog-protected Web Worker.
- Live **status bar**: pointer readout, per-tool hints, selection info, and live numbers during interactions (W×H while creating, ΔX/ΔY while moving, angle while rotating, new size while resizing)
- Undo / redo
- Pan (Space + drag, or middle mouse) and zoom (Ctrl/⌘ + wheel); fit all content (Shift+1), the selection (Shift+2), or the selected artboard from the zoom menu
- **Responsive / touch** layout: icon-only toolbar rail, slide-in panels, enlarged hit targets for coarse pointers, pinch-to-zoom & two-finger pan, on-screen Shift/Alt modifier bar
- Debug **project inspector** (app bar ▸ Inspect): searchable JSON tree of the whole store
- **Browser recovery autosave**: dirty documents are saved locally in IndexedDB and, after a reload/crash, offered for restore on next launch (Cancel discards); progress is reported in the status bar
- File: New, Open, Save (`.vinegar.json`), import SVG, place raster images, export PNG/JPEG/WebP with range, size, background and quality controls, export SVG, and load Demo

## SVG interoperability

Vinegar uses Canvas 2D and its own document model as the source of truth.
SVG import and export are **best-effort interchange features**, not a goal of full SVG specification coverage or lossless round-tripping.

- Import uses Paper.js and converts supported shapes, paths, compound paths, groups/layers, transforms, clipping groups and basic solid fill/stroke styles into editable Vinegar nodes
- SVG text, embedded images, gradients, patterns, filters and other unsupported SVG constructs may be omitted or lose appearance during import
- Export covers Vinegar vector geometry, text, embedded images, gradients, clipping masks, Brush outlines, blend modes and the supported effect stack
- Raster pattern paints currently export as a neutral placeholder rather than an SVG `<pattern>`; filter and blend rendering can also vary between SVG viewers

For appearance-critical exchange, use raster export.
For editable exchange, expect to inspect and adjust the imported or exported result.

## Document model

The persisted `Document` is a **unified scene tree**: a flat `nodes` map keyed by id, with `rootIds` and each group's `childIds` as the only source of hierarchy and back-to-front paint order.
Every node carries a Canvas/SVG-compatible affine `transform` into its parent space plus a `transformOrigin`; parents, world matrices and leaf shapes are derived (not stored).
The document also holds `symbols`, `artboards`, `assets` (embedded raster images), `settings` (unit, dpi, grid size), document-local generator `scripts`, `metadata` and namespaced `extensions`.
The file wrapper is versioned — the current version is v20; v8–v19 files migrate automatically on load, while older versions are unsupported.
See [docs/document-model.md](docs/document-model.md).

## Project layout

```
src/
  model/     types, geometry, hit-testing, matrix/affine transforms, bounds,
             scene index, groups, paint, snapping, freehand/brush geometry,
             erasing, boolean, compound paths, generators, outlineStroke,
             bucketFill
  store/     zustand editor store split into slices (shapes, selection,
             structure, symbols, artboards, clipboard, history, prefs),
             pointer & menu stores
  commands/  command registry (actions + shortcuts, drives menus & palette)
  canvas/    CanvasView (interaction), per-tool logic, rendering, overlay,
             handles, node chrome, image decode cache, text layout/editor
  script/    sandboxed one-shot drawing DSL (runScript + Web Worker)
  io/        JSON save/load (versioned + migrations), raster/SVG export,
             SVG/raster import, recovery autosave, export/snap bounds
  ui/        Toolbar, PropertiesPanel, LayersPanel, FileMenu, ColorField,
             ContextMenu, CommandPalette, export/preferences/script/generator
             dialogs, Inspector, dockable panels
  demo/      demo document
  App.tsx    layout, app bar, global shortcuts
docs/        document model and feature design notes
tests/       node --test model/store/persistence tests via Vite SSR
```

## Roadmap

See [TODO.md](TODO.md).
