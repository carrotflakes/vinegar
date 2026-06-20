# Vinegar

A browser-based **vector drawing app** built with React + TypeScript + Vite, rendering to an HTML5 **Canvas 2D** with a hand-rolled scene graph, hit-testing and selection.

## Stack

- React 18 + TypeScript + Vite
- Zustand for state (with undo/redo history)
- Canvas 2D rendering (no SVG/WebGL)
- Package manager: **pnpm**

## Getting started

```bash
pnpm install
pnpm dev        # start the dev server (http://localhost:5173)
pnpm build      # typecheck + production build
pnpm typecheck  # types only
```

## Features

- Tools: Select, Edit Nodes, Rectangle, Ellipse, Line, **Pen (Bézier)**, Pencil (freehand)
- Pen tool: click for corner anchors, click-drag for smooth anchors; click the
  first anchor to close, or Enter / double-click to finish, Esc to cancel
- Node editing: drag anchors and control handles (Alt to break handle symmetry),
  Delete to remove an anchor
- Move, resize (8 handles), **rotate** (rotation handle; Shift snaps to 15°)
- **Group / ungroup** (Ctrl/⌘+G, Ctrl/⌘+Shift+G) — grouped shapes select together
- Multi-select (shift-click & marquee)
- Fill / stroke color, stroke width, opacity, rotation
- Arrange: bring to front / send to back
- **Layers panel**: z-order list, click to select, drag to reorder, show/hide,
  lock/unlock, double-click to rename
- Undo / redo (Ctrl+Z / Ctrl+Shift+Z)
- Pan (Space + drag, or middle mouse) and zoom (Ctrl/⌘ + wheel)
- File: New, Open, Save (.json), Export PNG, Export SVG

### Keyboard

| Key | Action |
| --- | --- |
| `V` `N` `R` `O` `L` `P` `B` | Select / Nodes / Rect / Ellipse / Line / Pen / Pencil |
| `Enter` | Finish the current pen path |
| `Ctrl/⌘ + G` / `+ Shift + G` | Group / Ungroup |
| `Delete` / `Backspace` | Delete selection (or the active node) |
| `Ctrl/⌘ + Z` | Undo |
| `Ctrl/⌘ + Shift + Z` | Redo |
| `Esc` | Clear selection / cancel pen path |

## Project layout

```
src/
  model/        document types, geometry, hit-testing, transforms, viewport
  store/        zustand editor store (state + undo/redo)
  canvas/       CanvasView (interaction), rendering, overlay, handles
  ui/           Toolbar, PropertiesPanel
  App.tsx       layout, app bar, global shortcuts
```

## Ideas for next steps

- Save / load documents (JSON) and PNG/SVG export
- Bézier pen tool and per-vertex editing
- Rotation and group/transform support
- Layers panel
- Snapping & alignment guides
