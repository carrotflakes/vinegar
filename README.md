# Vinegar

A browser-based **vector drawing app** built with React + TypeScript + Vite,
rendering to an HTML5 **Canvas 2D** with a hand-rolled scene graph, affine
transforms, hit-testing and selection.

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
pnpm test       # node --test (serialization, clipping masks, symbols, text, viewport)
```

## Features

- Tools: Select, Edit Nodes, Rectangle, Ellipse, Line, **Pen (Bézier)**,
  Pencil (freehand), Text, Artboard
- Pencil: freehand strokes are simplified and smoothed into an editable Bézier
  path (tweak it with the Node tool); end near the start to close it
- Pen tool: click for corner anchors, click-drag for smooth anchors; click the
  first anchor to close, or Enter / double-click to finish, Esc to cancel;
  click an endpoint of an existing open path to continue it
- Node editing: drag anchors and control handles (Alt to break handle symmetry),
  click a segment to insert an anchor (curve-preserving), double-click an anchor
  to toggle smooth ↔ corner, Delete to remove an anchor; open/close a path via
  the properties panel
- Move, resize (8 handles), **rotate** (rotation handle; Shift snaps to 15°) —
  all driven by per-node **affine matrices**, so rotated/nested resize is exact
- **Movable rotation centers** (transform origin) per shape and group; a
  transient pivot for multi-selection
- **Group / ungroup**, including **nested groups**; grouped shapes select together
- **Clipping masks**: use the frontmost closed vector shape to clip a group;
  nested masks work in Canvas, PNG and SVG output and can be released for editing
- Multi-select (shift-click & marquee)
- Copy / cut / paste / duplicate (groups stay grouped on paste; **Paste here**
  from the canvas context menu)
- **Boolean operations**: union, subtract, intersect, exclude (Paper.js;
  curve-preserving — the result is a node-editable compound Bézier)
- **Compound paths**: retain closed source shapes behind one shared appearance,
  cut even-odd holes, and release back to the original shape types
- **Outline stroke**: convert a shape's stroke into a filled path (`clipper-lib`)
- **Paint model** for fill/stroke: solid colors with **per-color alpha** and
  **gradients** (linear & radial, with a stop editor) — rendered on Canvas and
  exported to SVG. Swatch popover with preset palette, recent colors, saved
  swatches, hex input, "none" and the **eyedropper**
- Stroke width plus **dash pattern/offset, cap, join and inside/center/outside
  alignment** (closed vectors and text), opacity, and per-node **blend modes**
  (multiply, screen, overlay, … — shapes and groups)
- **Effects**: non-destructive, Illustrator-style **ordered effect stack** on any
  node (shape / group / instance) — **Drop Shadow** and **Gaussian Blur**, applied
  after content but before opacity/blend, scaling with the transform and zoom;
  rendered on Canvas, exported to SVG (`<filter>`) and PNG, with export bounds
  grown so shadows/blur aren't cropped
- **Symbols** (reusable components): create from a selection, place instances,
  edit in an isolated view (double-click an instance), detach / rename / delete
- **Artboards**: non-owning frames on the infinite plane — create/move/resize
  with the Artboard tool, per-board (or all-board) PNG/SVG export
- **Raster images**: place via File ▸ Place image…, the canvas context menu, or
  drag & drop; images select/move/resize/rotate and take opacity/blend like any
  shape; embedded in the file as document assets
- **Text**: click for auto-width point text or drag for fixed-width wrapping
  text; in-place editing supports newlines, CJK wrapping, rotation, font/style
  controls, saved measured bounds, and Canvas/SVG/PNG output
- Numeric **X / Y / W / H** editing, **align & distribute** buttons
- Arrange: bring to front / send to back
- **Layers panel**: tree view of groups (collapse, show/hide, lock/unlock),
  z-order list, click to select, drag to reorder (across parents), double-click
  to rename
- **Command registry**: one source of truth for actions, driving keyboard
  shortcuts, the File menu, context menus and the **command palette**
  (Ctrl/⌘+K — shortcuts are discoverable there and in the menus)
- **Context menus** on the canvas and layers panel
- **Snapping**: edges/centers snap to other shapes (magenta alignment guides),
  equal-spacing distribution between neighbours (spacing markers), and an
  optional grid (adjustable size). Works while moving, **drawing, resizing, and
  editing pen vertices** — toggle "Snap" / "Grid" in the status bar
- **Scripting**: a one-shot drawing DSL that runs in a sandboxed Web Worker and
  applies its changes in a single undo step; can create shapes and read/edit
  existing ones (open via the "Script" button in the app bar)
- Live **status bar**: pointer readout, per-tool hints, selection info, and live
  numbers during interactions (W×H while creating, ΔX/ΔY while moving, angle
  while rotating, new size while resizing)
- Undo / redo
- Pan (Space + drag, or middle mouse) and zoom (Ctrl/⌘ + wheel); fit all content
  (Shift+1), the selection (Shift+2), or the selected artboard from the zoom menu
- **Responsive / touch** layout: icon-only toolbar rail, slide-in panels,
  enlarged hit targets for coarse pointers, pinch-to-zoom & two-finger pan,
  on-screen Shift/Alt modifier bar
- Debug **project inspector** (app bar ▸ Inspect): searchable JSON tree of the
  whole store
- **Browser recovery autosave**: dirty documents are saved locally in IndexedDB
  and, after a reload/crash, offered for restore on next launch (Cancel discards);
  progress is reported in the status bar
- File: New, Open, Save (.json), Export PNG, Export SVG, load Demo

## Document model

The persisted `Document` is a **unified scene tree**: a flat `nodes` map keyed by
id, with `rootIds` and each group's `childIds` as the only source of hierarchy
and back-to-front paint order. Every node carries a Canvas/SVG-compatible affine
`transform` into its parent space plus a `transformOrigin`; parents, world
matrices and leaf shapes are derived (not stored). The document also holds
`symbols`, `artboards`, `assets` (embedded raster images), `settings` (unit,
dpi, grid size), `metadata` and namespaced `extensions`. The file wrapper is
versioned — the current version is v17; v8–v16 files migrate automatically on
load, older versions are unsupported. See
[docs/document-model.md](docs/document-model.md).

## Project layout

```
src/
  model/     types, geometry, hit-testing, matrix/affine transforms, bounds,
             scene index, groups, paint, snapping, freehand, boolean,
             compound paths, outlineStroke
  store/     zustand editor store split into slices (shapes, selection,
             structure, symbols, artboards, clipboard, history, prefs),
             pointer & menu stores
  commands/  command registry (actions + shortcuts, drives menus & palette)
  canvas/    CanvasView (interaction), per-tool logic, rendering, overlay,
             handles, node chrome, image decode cache, text layout/editor
  script/    sandboxed drawing DSL (runScript + Web Worker)
  io/        JSON save/load (versioned + migrations), PNG/SVG export,
             image import, export/snap bounds
  ui/        Toolbar, PropertiesPanel, LayersPanel, FileMenu, ColorField,
             ContextMenu, CommandPalette, ScriptPanel, Inspector, RightSidebar
  demo/      demo document
  App.tsx    layout, app bar, global shortcuts
docs/        document-model.md
tests/       node --test (serialization, symbols, text, viewport)
```

## Roadmap

See [TODO.md](TODO.md).
