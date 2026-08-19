# Architecture

Status: **reference.** Describes the codebase as it is; kept current with it.

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
Frames are ordinary nodes in that tree (top-level only), so there is no separate list of page/canvas containers.
The document also holds `symbols`, global-color `swatches` (with a `swatchOrder`), `assets` (embedded raster images), `settings` (unit, dpi, grid size), document-local generator `scripts`, `metadata` and namespaced `extensions`.

The file wrapper is versioned by `CURRENT_FILE_VERSION` in `src/io/serialize.ts`.
There is no migration chain: files written by any other version are rejected with a clear message.

The model generally has **no optional fields**: every node writes its defaults explicitly (`blendMode: "normal"`, `effects: []`, `strokeDash: []`, `cornerRadius: 0`, …) and uses `null` for genuinely absent values.
The deliberate exception is an anchor's optional linkage tag `t`; old and generated geometry can omit it because cusp/smooth/symmetric linkage is derived from the handles.

See [document-model.md](document-model.md).

## Shape geometry: one derivation

Rendering, hit-testing, bucket fill, boolean ops, stroke outlining, bounds and SVG export all have to describe the *same* outline, so a shape's geometry is derived in exactly one place: **`src/model/path/shapeGeometry.ts`** (`shapeSubpaths` → `shapePolylines` → `shapeRings`, plus `shapeFillRule` and `isClosedGeometry`).
It resolves modifier stacks, brush envelopes and compound components — everything a reader would otherwise re-derive with its own `switch (shape.type)`.

A reader may keep a *fast path* only when its reason is **not** geometry, and it must be guarded on the shape still being an unmodified primitive (`!hasActiveModifiers(shape)`). The complete list:

| reader | fast path | why |
| --- | --- | --- |
| `canvas/render/path.ts` | `ctx.rect()`, `ctx.ellipse()` | hands the exact conic to the rasteriser |
| `io/exportSvg.ts` | `<rect>` / `<ellipse>` / `<line>` / `<text>` | output form; readable, editable SVG |
| `model/geometry/hitTest.ts` | `pointInRoundedRect`, the analytic ellipse | exact where flattening approximates |
| `model/geometry/bounds.ts` | a primitive's stored `x/y/width/height` | those fields *are* the bounds |

`tests/shapeGeometry.test.mjs` pins each fast path to the canonical geometry, and `tests/modifierReaders.test.mjs` fails the build if a new file branches on `rect`/`ellipse`/`line` without resolving modifiers first.

## Store: slices vs standalone stores

Two kinds of state live in `src/store/`, and the split is not stylistic:

- **Slices of the one editor store** (`*Slice.ts`, composed by `editorStore.ts`, declared in `state.ts`) — anything that *is* the document or a view of it: nodes, selection, focus, viewport. Document mutations go through `transact` / `beginInteraction`, so they are undoable.
- **Standalone `create()` stores** (`brushStore`, `pencilStore`, `gradientToolStore`, `penDraftStore`, `bucketStore`, `pointerStore`, `highlightStore`, `uiStore`, `menuStore`, `toastStore`, `documentFileStore`, `preferencesStore`, …) — session state that is never serialized and never undoable: tool options, in-flight drag scratch state, dialog visibility, the file handle, toasts.

When adding state, ask whether Undo should bring it back. If yes it belongs in a slice; if no it belongs in its own store, and putting it in a slice would push non-document data into history patches.

## Project layout

```
src/
  model/     types + scene index, groups, paint, bucketFill, plus subfolders:
             geometry/ (matrix/affine transforms, bounds, hit-testing,
             snapping, viewport), path/ (paths, boolean, compound paths,
             join/cut/combine/split, path cleanup ops, outlineStroke,
             freehand),
             brush/ (brush geometry + erasing), generators/
  store/     zustand editor store split into slices (shapes, path editing,
             assets, generators, selection, structure, shape ops, symbols,
             frames, clipboard, history, prefs), pointer & menu stores
  commands/  command types and placement helpers; editing, view and file
             command groups composed by the registry (drives menus & palette)
  canvas/    CanvasView (interaction), per-tool logic, rendering, overlay,
             handles, node chrome, image decode cache, text layout/editor
  script/    sandboxed one-shot drawing DSL (runScript + Web Worker)
  io/        save/load — the `.vinegar` container and the same file as JSON
             (single current version) — raster/SVG export, SVG/raster import,
             recovery autosave, export/snap bounds
  ui/        Toolbar, PropertiesPanel, LayersPanel, FileMenu, ColorField,
             ContextMenu, CommandPalette, export/preferences/script/generator
             dialogs, Inspector, dockable panels
  demo/      demo.vinegar.json (the bundled feature-tour document, a real save
             file) + its loader; the render-stress document
  App.tsx    layout, app bar, global shortcuts
docs/        document model and feature design notes
tests/       node --test model/store/persistence tests via Vite SSR
```

Imports into `src/` use the `@/` path alias (e.g. `@/model/path/boolean`); same-folder siblings stay relative.

**Panel vs section.** A *panel* is a dock tab (`ui/dock/panels.tsx` registry, `.panel` body); a *section* is one
titled block inside a panel body, rendered with `ui/panels/Section.tsx` (`.section` / `.section-title`) rather
than hand-written divs. Components under `ui/panels/<panel>/` are named `*Section` unless they are the panel
itself. In the properties panel every section titles only its own topic — the selection's kind and name are
stated once by `SelectionHeader`, never repeated in section titles. A section that passes an `id` becomes
foldable; the fold is remembered per id in `store/sectionFoldStore.ts`, outside the panel (the dock unmounts
inactive tabs) and outside history (it is view state).

**A field reports only what the whole selection agrees on.** Panel fields address every selected node at once,
so `ui/panels/properties/sharedValue.ts` reads a value across the selection and flags it `mixed` when the
nodes disagree; the field then renders blank ("Mixed") rather than one node's value, which would read as
"they are all like this" and invite an edit that silently overwrites the others. `ScrubbableNumber` and
`ColorField` take a `mixed` prop, and `<select>`s use `MIXED_OPTION` / `MixedOption` from `StyleFields.tsx`.
Editing a mixed field still commits to every selected node.

## Design notes

Every per-area note is indexed in [README.md](README.md): cross-cutting
contracts in [`reference/`](reference/), one note per feature in
[`design/`](design/). Check there before designing in an area — the index is
kept current, and a list repeated here would not be.
