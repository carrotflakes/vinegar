# Vinegar

A browser-based **vector drawing app** built with React + TypeScript + Vite,
rendering to an HTML5 **Canvas 2D** with a hand-rolled scene graph, affine
transforms, hit-testing and selection.

## Stack

- React 18 + TypeScript + Vite
- Zustand for state (with undo/redo history)
- Canvas 2D rendering (no SVG/WebGL)
- `polygon-clipping` for boolean path operations; `clipper-lib` for stroke outlining
- `react-icons` (Lucide) for the toolbar; `@floating-ui/react-dom` for popovers
- Package manager: **pnpm**

## Getting started

```bash
pnpm install
pnpm dev        # start the dev server (http://localhost:5173)
pnpm build      # typecheck + production build
pnpm typecheck  # types only
pnpm test       # node --test (document serialization)
```

## Features

- Tools: Select, Edit Nodes, Rectangle, Ellipse, Line, **Pen (Bézier)**, Pencil (freehand)
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
- **Group / ungroup** (Ctrl/⌘+G, Ctrl/⌘+Shift+G), including **nested groups**;
  grouped shapes select together
- Multi-select (shift-click & marquee)
- Copy / cut / paste / duplicate (groups stay grouped on paste; **Paste here**
  from the canvas context menu)
- **Boolean operations**: union, subtract, intersect, exclude (closed shapes →
  a single polygon with holes, via `polygon-clipping`)
- **Compound paths**: retain closed source shapes behind one shared appearance,
  cut even-odd holes, and release back to the original shape types (`Ctrl/⌘+8`)
- **Outline stroke**: convert a shape's stroke into a filled path (`clipper-lib`)
- Fill / stroke color (swatch popover with preset palette, recent colors, saved
  swatches, hex input, "none" and the **eyedropper**), stroke width, opacity,
  and per-node **blend modes** (multiply, screen, overlay, … — shapes and groups)
- Numeric **X / Y / W / H** editing, **align & distribute** buttons
- Arrange: bring to front / send to back
- **Layers panel**: tree view of groups (collapse, show/hide, lock/unlock),
  z-order list, click to select, drag to reorder (across parents), double-click
  to rename
- **Context menus** on the canvas and layers panel (a shared menu foundation)
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
- Undo / redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)
- Pan (Space + drag, or middle mouse) and zoom (Ctrl/⌘ + wheel)
- **Responsive / touch** layout: icon-only toolbar rail, slide-in panels, and
  enlarged hit targets for coarse pointers
- File: New, Open, Save (.json), Export PNG, Export SVG, load Demo

### Keyboard

| Key | Action |
| --- | --- |
| `V` `N` `R` `O` `L` `P` `B` | Select / Nodes / Rect / Ellipse / Line / Pen / Pencil |
| `Enter` | Finish the current pen path |
| `Ctrl/⌘ + G` / `+ Shift + G` | Group / Ungroup |
| `Ctrl/⌘ + A` | Select all |
| `Ctrl/⌘ + C / X / V` | Copy / Cut / Paste |
| `Ctrl/⌘ + D` | Duplicate |
| `Delete` / `Backspace` | Delete selection (or the active node) |
| `Ctrl/⌘ + Z` | Undo |
| `Ctrl/⌘ + Shift + Z` / `Ctrl/⌘ + Y` | Redo |
| `Esc` | Clear selection / cancel pen path |

## Document model

The persisted `Document` is a **unified scene tree**: a flat `nodes` map keyed by
id, with `rootIds` and each group's `childIds` as the only source of hierarchy
and back-to-front paint order. Every node carries a Canvas/SVG-compatible affine
`transform` into its parent space plus a `transformOrigin`; parents, world
matrices and leaf shapes are derived (not stored). The document also holds
`settings` (unit, dpi, grid size), `metadata`, `assets` and namespaced
`extensions`. The file wrapper is versioned and strict — only the current
version (v6) loads. See [docs/document-model.md](docs/document-model.md).

## Project layout

```
src/
  model/    types, geometry, hit-testing, matrix/affine transforms, rotate,
            bounds, scene index, groups, snapping, freehand, boolean, outlineStroke
  store/    zustand editor store (state + undo/redo), pointer & menu stores
  canvas/   CanvasView (interaction), rendering, overlay, handles, node chrome
  script/   sandboxed drawing DSL (runScript + Web Worker)
  io/       JSON save/load (versioned), PNG/SVG export, export/snap bounds
  ui/       Toolbar, PropertiesPanel, LayersPanel, FileMenu, ColorField,
            ContextMenu, ScriptPanel, RightSidebar
  demo/     demo document
  App.tsx   layout, app bar, global shortcuts
docs/       document-model.md
tests/      document serialization tests (node --test)
```

## Ideas for next steps

- Alignment guides during resize and rotate (currently move only)
- Pinch-to-zoom & two-finger pan; on-screen alternatives for keyboard actions
- Text tool; rounded rectangles; gradients / textures; raster images
- Scripting: `bezier()`, group creation, auto-fit to generated content
- Boolean operations across different parent groups
