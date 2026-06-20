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

## Features (MVP)

- Tools: Select, Rectangle, Ellipse, Line, Pencil (freehand)
- Move, resize (8 handles), multi-select (shift-click & marquee)
- Fill / stroke color, stroke width, opacity
- Arrange: bring to front / send to back
- Undo / redo (Ctrl+Z / Ctrl+Shift+Z)
- Pan (Space + drag, or middle mouse) and zoom (Ctrl/⌘ + wheel)

### Keyboard

| Key | Action |
| --- | --- |
| `V` `R` `O` `L` `P` | Select / Rect / Ellipse / Line / Pencil |
| `Delete` / `Backspace` | Delete selection |
| `Ctrl/⌘ + Z` | Undo |
| `Ctrl/⌘ + Shift + Z` | Redo |
| `Esc` | Clear selection |

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
