# Architecture

Developer-facing overview of how the codebase is organised.
For the feature catalogue see [features.md](features.md); for the persisted format in detail see [document-model.md](document-model.md).

## Stack

- React 19 + TypeScript + Vite
- Zustand for state
- Canvas 2D rendering (no SVG/WebGL)
- Paper.js for boolean path operations; `clipper-lib` for stroke outlining
- `react-icons` (Lucide) for the toolbar; `@floating-ui/react` for menus and popovers
- Package manager: **pnpm**

## Document model

The persisted `Document` is a **unified scene tree**: a flat `nodes` map keyed by id, with `rootIds` and each group/frame/compound-path container's `childIds` as the only source of hierarchy and back-to-front paint order.
Every node carries a Canvas/SVG-compatible affine `transform` into its parent space plus a `transformOrigin`; parents, world matrices and leaf shapes are derived (not stored).
Frames are ordinary nodes in that tree (top-level only), so there is no separate artboard list.
The document also holds `symbols`, global-color `swatches` (with a `swatchOrder`), `assets` (embedded raster images), `settings` (unit, dpi, grid size), document-local generator `scripts`, `metadata` and namespaced `extensions`.

The file wrapper is versioned by `CURRENT_FILE_VERSION` in `src/io/serialize.ts`.
There is no migration chain: files written by any other version are rejected with a clear message.

The model generally has **no optional fields**: every node writes its defaults explicitly (`blendMode: "normal"`, `effects: []`, `strokeDash: []`, `cornerRadius: 0`, …) and uses `null` for genuinely absent values.
The deliberate exception is an anchor's optional linkage tag `t`; old and generated geometry can omit it because cusp/smooth/symmetric linkage is derived from the handles.

See [document-model.md](document-model.md).

## Project layout

```
src/
  model/     types + scene index, groups, paint, bucketFill, plus subfolders:
             geometry/ (matrix/affine transforms, bounds, hit-testing,
             snapping, viewport), path/ (paths, boolean, compound paths,
             join/cut/combine/split, path cleanup ops, outlineStroke,
             freehand),
             brush/ (brush geometry + erasing), generators/
  store/     zustand editor store split into slices (shapes, selection,
             structure, symbols, frames, clipboard, history, prefs),
             pointer & menu stores
  commands/  command types and placement helpers; editing, view and file
             command groups composed by the registry (drives menus & palette)
  canvas/    CanvasView (interaction), per-tool logic, rendering, overlay,
             handles, node chrome, image decode cache, text layout/editor
  script/    sandboxed one-shot drawing DSL (runScript + Web Worker)
  io/        JSON save/load (single current version), raster/SVG export,
             SVG/raster import, recovery autosave, export/snap bounds
  ui/        Toolbar, PropertiesPanel, LayersPanel, FileMenu, ColorField,
             ContextMenu, CommandPalette, export/preferences/script/generator
             dialogs, Inspector, dockable panels
  demo/      demo document
  App.tsx    layout, app bar, global shortcuts
docs/        document model and feature design notes
tests/       node --test model/store/persistence tests via Vite SSR
```

Imports into `src/` use the `@/` path alias (e.g. `@/model/path/boolean`); same-folder siblings stay relative.

**Panel vs section.** A *panel* is a dock tab (`ui/dock/panels.tsx` registry, `.panel` body); a *section* is one
titled block inside a panel body, rendered with `ui/panels/Section.tsx` (`.section` / `.section-title`) rather
than hand-written divs. Components under `ui/panels/<panel>/` are named `*Section` unless they are the panel
itself. In the properties panel every section titles only its own topic — the selection's kind and name are
stated once by `SelectionHeader`, never repeated in section titles.

## Design notes

Per-area notes live alongside this file in `docs/`:

- [anchor-types.md](anchor-types.md) — cusp / smooth / symmetric anchors
- [brush-strokes.md](brush-strokes.md) — brush centerlines and width envelopes
- [bucket-fill.md](bucket-fill.md) — vector region detection and gap closing
- [compound-path-nodes.md](compound-path-nodes.md) — compound paths as real child nodes
- [document-model.md](document-model.md) — the persisted format
- [drag-and-drop.md](drag-and-drop.md) — pointer-based drag conventions
- [global-colors.md](global-colors.md) — document color swatches and references
- [path-commands.md](path-commands.md) — join / cut / combine / split and cleanup ops
- [pen-and-touch.md](pen-and-touch.md) — stylus vs finger roles, palm rejection, touch gestures
- [path-modifiers.md](path-modifiers.md) — direction for a non-destructive modifier stack
- [path-unification.md](path-unification.md) — unifying shape and path representations
- [recent-files.md](recent-files.md) — recent-files list (*shelved design proposal, not implemented*)
- [render-performance.md](render-performance.md) — rendering cost and caching
- [rulers-and-guides.md](rulers-and-guides.md) — rulers, guides and ruler origin
- [undo-history.md](undo-history.md) — history model
