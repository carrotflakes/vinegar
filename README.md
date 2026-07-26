# Vinegar

Vinegar is a browser-based vector graphics editor for precise drawing and illustration, with Bézier editing, pressure-sensitive brushes, reusable symbols, global colors, frames, and flexible export.

## Getting started

```bash
pnpm install
pnpm dev        # start the dev server (http://localhost:5173)
pnpm build      # typecheck + production build
pnpm typecheck  # types only
pnpm test       # node --test (model, store, persistence, import and recovery)
```

Built with React 19 + TypeScript + Vite, Zustand and Canvas 2D rendering.

## Features

- **Drawing tools** — Pen (Bézier), Brush with pen pressure and variable width, Pencil, Eraser, Bucket Fill, Rectangle, Ellipse, Line, Text and Frame
- **Node editing** — cusp / smooth / symmetric anchors, handle dragging, inserting and removing anchors, opening and closing paths
- **Transforms** — move, resize, rotate and movable rotation centers, all on exact affine matrices
- **Structure** — groups, nested groups, clipping masks, compound paths and a drag-to-reorder layers tree
- **Path operations** — boolean union / subtract / intersect / exclude and divide, join, cut, combine, split subpaths, simplify, smooth, flatten, reverse, and outline stroke
- **Appearance** — solid colors, gradients and raster patterns, stroke dashes / caps / joins / alignment, opacity, blend modes, and a non-destructive effect stack (drop shadow, blur, color adjust, color overlay)
- **Reuse** — symbols with editable instances, and global colors that re-tint every use at once
- **Frames** — container nodes with their own coordinate space, background and optional clipping; drag artwork in and out, and export per frame
- **Images and text** — embedded raster assets, point and wrapping text with CJK support
- **Scripting** — a sandboxed drawing DSL and experimental parametric generators
- **Workspace** — snapping and guides, rulers, command palette, context menus, touch and pen support, undo / redo, and autosave recovery after a crash
- **Files** — save and open `.vinegar.json`, import SVG, export PNG / JPEG / WebP and SVG

The full, detailed list is in [docs/features.md](docs/features.md).

## SVG interoperability

Vinegar uses Canvas 2D and its own document model as the source of truth.
SVG import and export are **best-effort interchange features**, not a goal of full SVG specification coverage or lossless round-tripping.
For appearance-critical exchange, use raster export; for editable exchange, expect to inspect and adjust the result.
Details: [docs/features.md](docs/features.md#svg-interoperability).

## Documentation

- [docs/architecture.md](docs/architecture.md) — stack, document model and project layout
- [docs/features.md](docs/features.md) — full feature reference
- [docs/](docs/) — per-feature design notes
- [TODO.md](TODO.md) — roadmap
