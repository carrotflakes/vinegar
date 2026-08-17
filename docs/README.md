# Vinegar docs

Every page starts with a **Status** line saying what it is — current behaviour,
a partly-built proposal, or a record of something already done. Trust that line
before you trust the prose.

Three kinds of page, one per folder:

| | What it holds | When to read it |
| --- | --- | --- |
| **this folder** | the three entry points | before any non-trivial change |
| [`reference/`](reference/) | cross-cutting contracts | before touching the subsystem they govern — these are rules, not descriptions |
| [`design/`](design/) | one note per feature | before designing in that area, and update it when the behaviour changes |

`../TODO.md` is the roadmap. `../AGENTS.md` holds the repository conventions.

## Start here

| Page | |
| --- | --- |
| [architecture.md](architecture.md) | stack, store slicing, canvas pipeline, project layout |
| [document-model.md](document-model.md) | the persisted `Document`, its invariants and the coordinate policy (file **v37**) |
| [features.md](features.md) | a one-line-per-feature map of what exists |

## Reference — contracts

| Page | The rule it enforces |
| --- | --- |
| [scene-traversal.md](reference/scene-traversal.md) | `sceneWalk.ts` is the only place that answers "what is inside this container" |
| [undo-history.md](reference/undo-history.md) | every document mutation goes through `transact` / `beginInteraction` |
| [path-commands.md](reference/path-commands.md) | what each `path.*` / `structure.*` command must preserve, and when one must refuse |
| [render-performance.md](reference/render-performance.md) | culling, caches and the temporary-layer budget |
| [drag-and-drop.md](reference/drag-and-drop.md) | all in-app dragging is pointer-based, never HTML5 DnD |
| [pen-and-touch.md](reference/pen-and-touch.md) | how pen, finger, palm and gestures are told apart |

## Design notes — per feature

**Geometry and paths**

| Page | Status |
| --- | --- |
| [anchor-types.md](design/anchor-types.md) | shipped — cusp / smooth / symmetric anchors |
| [path-modifiers.md](design/path-modifiers.md) | shipped — the non-destructive geometry stack (v33) |
| [brush-strokes.md](design/brush-strokes.md) | phases 1–2 shipped — variable-width centerlines (v19) |
| [bucket-fill.md](design/bucket-fill.md) | v1 shipped — vector region detection |
| [markers.md](design/markers.md) | shipped — arrowheads and end markers (v35) |

**Structure**

| Page | Status |
| --- | --- |
| [symbols.md](design/symbols.md) | v1 shipped — definitions and instances, no overrides yet |
| [clipping-masks.md](design/clipping-masks.md) | shipped — frontmost child clips its group |
| [focus.md](design/focus.md) | shipped — isolation editing of a frame, group or symbol |
| [parameters.md](design/parameters.md) | shipped — document parameters bound to number fields (v32) |

Frames have no separate note: their model, the top-level-only invariant and
`settleNewFrame` are all in [document-model.md](document-model.md).

**Appearance**

| Page | Status |
| --- | --- |
| [effects.md](design/effects.md) | shipped — the effect stack (v37) |
| [gradients.md](design/gradients.md) | shipped — linear / radial / conic ramps |
| [freeform-gradients.md](design/freeform-gradients.md) | shipped — scattered colour points (v36) |
| [global-colors.md](design/global-colors.md) | shipped — swatch references (v23) |

**Canvas and app**

| Page | Status |
| --- | --- |
| [rulers-and-guides.md](design/rulers-and-guides.md) | v1 shipped (v28) |
| [pwa.md](design/pwa.md) | shipped — installable and offline |

## Adding a page

- Put it in `design/` unless it is a rule other subsystems must obey.
- First line after the title is `Status:` — say whether it is shipped, partial or
  a proposal, and name the file version if the format moved.
- Link the related notes from that Status line; add a row here.
- When a plan is finished, rewrite the page to describe the result. If nothing
  in it survives that rewrite, delete the page — git keeps it, and a note nobody
  will read costs more than it stores.
