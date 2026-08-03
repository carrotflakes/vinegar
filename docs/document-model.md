# Document model

`Document` is the complete persisted drawing state. Editor state such as the
active tool, selection, viewport and undo history does not belong in the file.

## Invariants

- Every key in `nodes` equals that shape or group's `id`.
- Node fields are required unless absence is a stable default for additive
  compatibility (for example, absent `modifiers` means an empty stack).
  Defaults are stored explicitly (`blendMode: "normal"`, `effects: []`); a
  genuinely absent value is `null`. `undefined` is invalid for required fields.
- `rootIds` and each container's `childIds` are back-to-front and are the only
  persisted sources of hierarchy and paint order.
- Every node is owned exactly once by either `rootIds` or one `childIds` list.
- Missing children, multiple ownership, duplicate ownership, cycles and
  unreachable nodes are invalid. Empty groups are valid.
- Parent ids, ancestors, depth, leaf shapes, inherited visibility/locking and
  world matrices are derived by the Scene Index and are not persisted.
- Leaf shape types are `rect`, `ellipse`, `line`, `path`, `image`, `text`, and
  `brush`. A `path` is the canonical vector-outline shape:
  it stores one or more `subpaths`, each with cubic anchors (`p`, `hIn`,
  `hOut`, and optional linkage tag `t`) and a `closed` flag. Null handles make
  straight segments; absent `t` is derived from the handle geometry.
- A path's `fillRule` is either `nonzero` or `evenodd`. The rule applies to all subpaths consistently in
  rendering, hit-testing, clipping, boolean input, and SVG export. Filling
  implicitly closes open subpaths without closing their strokes.
- Asset-bearing nodes reference entries in `assets` by id; binary data does not
  belong directly in a node. `image` nodes and `pattern` fills/strokes both
  reference an image asset; an asset survives save only while something still
  references it (see `referencedAssetIds`).
- `fill`/`stroke` are a `Paint` union: `solid`, linear/radial `gradient`, a
  `pattern` (an image asset mapped onto the shape by an explicit `mode` —
  tile / fill / fit / stretch — plus `scale`/`rotation`/`offset`), or a
  `var` reference (`varId` plus a per-use `alpha`, `1` = the variable's own
  alpha unchanged; on a gradient the tint scales every stop). A variable stores
  any *concrete* paint — solid, gradient or pattern — but never another
  reference, so resolution is single-hop. A pattern that references a
  decoding/missing asset simply paints nothing that frame.
- Stroke appearance is stored directly on each shape: width, dash array/offset,
  cap, join and alignment. An empty dash array means a solid stroke.
  Inside/outside alignment is effective only for closed vector geometry and
  text; open paths render centered.
- Rectangles store one non-negative `cornerRadius` shared by all four corners
  (`0` = square). Rendering clamps the effective radius to half the rectangle's
  shorter side.
- Extension data uses namespaced keys in `extensions` and must be JSON-safe.
- A compound path is a paintable container node. Its non-empty `childIds` owns
  only `rect`, `ellipse`, and closed `path` nodes. The children retain their
  transforms and appearance fields, but only visible child outlines contribute
  while contained; the compound's appearance paints the combined outline once
  using the even-odd rule. Scene picking remains atomic at the compound while
  the node tool can edit path children.
- A frame is a container node with a content box: `width`/`height` in its own
  local space (origin at `0,0`, i.e. an SVG-style viewport), a `background`
  paint colour (`null` = transparent) and a `clipsContent` flag. Its `childIds`
  are authored in frame-local coordinates and move with
  the frame through the ordinary transform chain — membership is structural, not
  geometric.
- **Frames live only at the top level.** A frame id appears in `rootIds` and
  never in any node's `childIds` or inside a symbol definition, so frames never
  nest and are never grouped, clipped or made into symbol content. Frame order
  within `rootIds` is also the export order. Every reparent/group operation and
  the file validator enforce this.
- A group with `clipsToMask: true` uses its final (frontmost) child as a vector
  clipping mask and paints only the preceding children. The flag is named apart
  from the frame's `clipsContent` on purpose: the two used to share the name
  `clip` with opposite defaults. The mask must be an
  area-bearing vector shape; its paint and visibility fields are preserved but
  ignored while it supplies clip geometry. Because "the mask" is a *position*
  rather than a flag, an editing operation that replaces the mask with several
  nodes, or with a group, leaves a tree that is still structurally valid but no
  longer means what it did — see the clipping-mask rule in
  [path-commands.md](path-commands.md).
- A brush shape is a pressure-profiled variable-width stroke. It stores an open
  cubic-Bézier centerline as `anchors` (same anchor convention and optional
  cusp/smooth/symmetric linkage tag as `path`) where each anchor also
  carries a width multiplier `w >= 0`. The rendered shape is the filled envelope
  of that centerline (`strokeWidth * w` wide, round end caps), painted with the
  `stroke` paint using the nonzero winding rule. `fill` and the stroke detail
  fields (dash/cap/join/alignment) are unused; bounds and hit-testing derive
  from the envelope, so `strokeOutset` is zero.
- Text is a leaf shape, not compound-path geometry. Point text stores its
  measured width; area text stores its fixed wrapping width; both store the
  measured auto-height so bounds and hit-testing never need a live font.
  Typography is one style per node (`fontFamily`, size, weight, italic,
  line-height and alignment); line layout is derived from the text at render.
  Those stored bounds are a cache of a measurement, not authored data: a writer
  without font metrics (a script, another tool, a hand edit) can only estimate
  them. Opening a document therefore remeasures every text node against the real
  font and, when they differ, silently corrects them — no undo entry, and the
  repaired document is the saved baseline, so a file is never reported dirty just
  for being healed. The same pass runs again whenever the browser reports that
  available fonts changed. `remeasureDocumentText` in `src/canvas/textLayout.ts`
  is the single implementation; it needs a DOM, so callers that might run
  headless gate on `canMeasureText()` rather than writing a guess.

- **Document variables** (`doc.vars` / `doc.varOrder`, a bijection) are named
  values the document shares. A variable's `value` is typed: `kind: "number"`
  (with its scrubber hints) or `kind: "paint"` (a concrete paint). One table,
  two reference edges — paint points *in* the field (above), numbers *beside*
  it.
- A number field can be driven by a number variable. The reference lives in
  `node.bindings`, keyed by bindable field path (`"strokeWidth"`,
  `"generator.args.<key>"`, `"modifiers.<index>.<key>"`), while the field itself
  holds the last resolved number — so every consumer reads a plain `number` and
  a dangling reference degrades to the value it was showing. Bound fields are
  derived state: `syncParamBindings` re-resolves them on every committed
  document, and a binding whose field path no longer addresses anything is
  pruned there. See [parameters.md](parameters.md).
- A **symbol definition** may declare `params` (key, label, typed `default`);
  an **instance** overrides them in `args`, keyed by the same key. A `var` paint
  inside a definition resolves against the instance's args, then the
  definition's defaults, then `doc.vars` — so one definition paints differently
  per instance. Numeric symbol parameters are declarable but not yet honoured
  (phase 2b). See [parameters.md](parameters.md).

- A path's modifier stack may hold a `boolean` stage, which combines the
  stage's input with another node's geometry (`operandId`). It is the only
  reference a node holds to another node's *geometry*; those edges must form a
  DAG (`hasAcyclicModifierOperands`), and a missing operand disables the stage.
  See [path-modifiers.md](path-modifiers.md).

The current file version is v35; loading also accepts v34 (which simply has no
boolean stage) and v31–v33 files, which are
transformed on read: their `swatches` and `params` fold into one `vars` table
(ids unchanged), `swatch` paints become `var` paints, symbols gain an empty
parameter list and instances empty args. Persisted model changes require a
version review and, when incompatible, a migration.

## Coordinate policy

Geometry is stored in node-local coordinates. Each shape and group has a
Canvas/SVG-compatible affine matrix `[a, b, c, d, e, f]` mapping it into its
parent space. World transforms are composed from the root toward the node.

Each shape and group also stores `transformOrigin` in its own local space.
`null` means the current geometry/content bounds center; an explicit point may
sit outside those bounds and is preserved across selection and file reloads.
Ad-hoc multi-selection pivots are editor state and are not persisted.

Rendering, bounds, hit-testing, snapping, editing and export must all use the
same composed matrix. A partially applied transform is invalid document state.

**Lengths are node-local too.** `strokeWidth`, `strokeDash`/`strokeDashOffset`,
effect radii and offsets, and a brush anchor's width all live in the node's own
units and are scaled by the transform chain, exactly like the geometry — the
renderer applies `node.transform` and *then* sets `ctx.lineWidth`. So a node's
stored `strokeWidth` is not its rendered thickness unless its world matrix has
unit scale.

The consequence for editing operations: baking a transform into anchors while
copying those fields verbatim silently rescales every one of them. An operation
that flattens a transform must either scale the lengths to match or keep the
space it took the style from. See [path-commands.md](path-commands.md) for how
each shape command handles this.
