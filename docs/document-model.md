# Document model

Status: **reference.** The persisted format as it is, at file version **v37**,
written either as the `.vinegar` container or as `.vinegar.json` text.
Any change to the shape of the file means bumping `CURRENT_FILE_VERSION` in
`src/io/serialize.ts` and updating this page in the same commit.

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
  `brush`. `rect`, `ellipse`, `line` and `path` may carry a `modifiers` stack —
  a non-destructive chain of geometry stages evaluated over the shape's own
  geometry (see [path-modifiers.md](design/path-modifiers.md)); the shape's own fields
  stay the editable base. A `path` is the canonical vector-outline shape:
  it stores one or more `subpaths`, each with cubic anchors (`p`, `hIn`,
  `hOut`, and optional linkage tag `t`) and a `closed` flag. Null handles make
  straight segments; absent `t` is derived from the handle geometry.
- `line` and `path` — the shapes that can be *open* — may also carry
  `markerStart` / `markerEnd`: an end marker (arrowhead, dot, tick) drawn at
  each open end of the resolved geometry, painted with the shape's stroke paint
  at its stroke width. An absent field means that end has no marker. See
  [markers.md](design/markers.md).
- A path's `fillRule` is either `nonzero` or `evenodd`. The rule applies to all subpaths consistently in
  rendering, hit-testing, clipping, boolean input, and SVG export. Filling
  implicitly closes open subpaths without closing their strokes.
- Asset-bearing nodes reference entries in `assets` by id; binary data does not
  belong directly in a node. `image` nodes and `pattern` fills/strokes both
  reference an image asset; an asset survives save only while something still
  references it (see `referencedAssetIds`).
- `fill`/`stroke` are a `Paint` union: `solid`, a `gradient` (`kind`
  linear/radial/conic; a unit-space ramp placed by `start`/`end`/`ratio`/
  `focal`, held either relative to the shape's bounds or in its local units;
  plus `spread`, `interpolation` and stops carrying `id`, `offset`, `color`,
  `alpha` and a blend `midpoint` — see `design/gradients.md`), a `freeform`
  gradient (scattered colour `points` — each with `id`, `position`, `color`,
  `alpha` and a `weight` — interpolated by `method` (`shepard`/`gaussian`) at
  a given `falloff`, in the same `bounds`/`local` space a gradient uses; see
  `design/freeform-gradients.md`), a
  `pattern` (an image asset mapped onto the shape by an explicit `mode` —
  tile / fill / fit / stretch — plus `scale`/`rotation`/`offset`), or a
  `swatch` reference (`swatchId` plus a per-use `alpha`, `1` = the swatch's
  own alpha unchanged). A pattern that references a decoding/missing asset
  simply paints nothing that frame.
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
- **Creating a frame settles it into the scene it lands on** (`settleNewFrame`
  in `src/store/docOps.ts`, used by both the frame tool and the Add frame
  command). A frame's background paints over whatever is behind it, so at
  creation time — and only then — top-level nodes that fall *completely* inside
  the new frame become its children (rebased into frame-local space), and the
  frame is inserted behind the backmost visible top-level node it overlaps, so
  art that only partly overlaps stays visible. With no overlap the frame keeps
  the frontmost slot and the natural export order. Hidden nodes are ignored;
  locked ones are not absorbed but still hold the frame back. Other frames are
  untouched — frames never nest. Moving an existing frame never absorbs
  anything.
- A group with `clipsToMask: true` uses its final (frontmost) child as a vector
  clipping mask and paints only the preceding children. The flag is named apart
  from the frame's `clipsContent` on purpose: the two used to share the name
  `clip` with opposite defaults. The mask must be an
  area-bearing vector shape; its paint and visibility fields are preserved but
  ignored while it supplies clip geometry. Because "the mask" is a *position*
  rather than a flag, an editing operation that replaces the mask with several
  nodes, or with a group, leaves a tree that is still structurally valid but no
  longer means what it did — see the clipping-mask rule in
  [path-commands.md](reference/path-commands.md).
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

- A number field can be driven by a *document parameter* (`doc.params` /
  `doc.paramOrder`, a bijection like swatches). The reference lives beside the
  field, in `node.bindings` keyed by bindable field path (`"strokeWidth"`,
  `"generator.args.<key>"`, `"modifiers.<index>.<key>"`), while the field itself
  holds the last resolved number — so every consumer reads a plain `number` and
  a dangling reference degrades to the value it was showing. Bound fields are
  derived state: `syncParamBindings` re-resolves them on every committed
  document, and a binding whose field path no longer addresses anything is
  pruned there. See [parameters.md](design/parameters.md).

The current file version is v37 and it is the only version loading accepts.
Persisted model changes require a version review and, when incompatible, a
migration.

## On-disk forms

The same file object — `{ app: "vinegar", version, document }`, built once by
`buildVinegarFile` — is written in either of two forms. They are told apart by
content, not by name, and both are validated by `parseVinegarFile`:

| Form | Extension | What it is |
| --- | --- | --- |
| Container (default) | `.vinegar` | Small binary wrapper: the JSON body deflated, image assets stored as raw bytes |
| JSON | `.vinegar.json` | The same file as pretty-printed text — readable, diffable, and what the demo document ships as |

The container is a size optimisation, not a model change: it holds no
information the JSON form lacks, so switching forms never bumps
`CURRENT_FILE_VERSION`. Its wrapper is versioned separately by
`CONTAINER_VERSION` in `src/io/container.ts`, whose header comment carries the
byte layout. On a real drawing the body deflates to roughly a fifteenth of the
JSON text, and base64 image assets shed the 33% they cost as data URLs.

`parseDocumentBytes` is the single reader for "bytes to document" — files,
drops, the recovery snapshot and the clipboard payload all come through it, so
none of them has to guess which form it holds. Saving follows the filename, so
a document opened from either form saves back into it (`documentFormatOf` in
`src/io/saveDocument.ts`), and the save picker offers both. The recovery
snapshot stores container bytes (`RECOVERY_FORMAT_VERSION` 2) and the clipboard
payload is a base64'd container, both of which also accept the JSON form on the
way in. Assets are rehydrated into ordinary `{ type: "data", data }` data
URLs while decoding, so nothing downstream of the loader knows which form the
file was in.

## Two decisions worth knowing about

Both were migrations, and both exist to keep the rules above from having
exceptions:

- **One vector-outline type** (v21). `path`, `bezier`, `polygon`, `compoundPath`
  and `brush` used to be five overlapping outline types, so thirteen consumers
  switched on shape type and the fill rule was hardcoded per type. They
  collapsed into `path` plus an explicit `fillRule`.
- **Hierarchy lives in exactly one place** (v22). A compound path used to store
  its sources inline in `components: PrimitiveShape[]` — the only hierarchy
  outside `nodes`/`childIds`, and therefore invisible to the Scene Index, the
  layers panel, copy/paste and `validateTree`, each of which needed a parallel
  implementation. It became a container node with ordinary `childIds`.

The full plans lived in this folder as path-unification and compound-path-nodes
notes, and were removed once carried out; git history has them.

## Carrying appearance across an operation

Boolean ops, join, combine, compound path, split and the brush/path conversions
all build a *new* node meant to look like the one it came from. None of them
lists the fields to copy by hand — every one spreads the shared helpers, so a
new appearance field reaches all of them at once:

| Helper | Where | Covers |
| --- | --- | --- |
| `shapePaintFields(shape)` | `model/stroke.ts` | every paint/stroke field a shape adds on top of `BaseNode` |
| `nodeCompositeFields(node)` | `model/types.ts` | `opacity`, `blendMode` |
| `nodeAppearanceFields(node)` | `model/types.ts` | the above plus a cloned `effects`, `hidden`, `locked` |
| `markerFields(shape)` | `model/marker.ts` | `markerStart` / `markerEnd`, absent ends staying absent |

`baseNodeDefaults()` / `baseShapeDefaults()` are the *construction* counterparts:
neutral values for a node built from scratch rather than derived from another.

An op that deliberately drops something says so by choosing the narrower helper
— boolean, join and combine bake geometry their effect stack was tuned against,
so they spread `baseNodeDefaults()` with `nodeCompositeFields`, never
`nodeAppearanceFields`. An op that deliberately *changes* one field spreads the
helper and then overrides that field, so the exception reads as intentional
(see `convertBrushToOutlinePath`, where the brush's stroke becomes the ring's
fill).

`ShapePaintFields` in `model/types.ts` is `Omit<BaseShape, keyof BaseNode>` —
an omit rather than an enumerated pick on purpose. Adding a field to `BaseShape`
then fails to compile in exactly two builders (`baseShapeDefaults` and
`shapePaintFields`) instead of silently dropping out of the sites above.
`StyleDefaults` and `StyleStylableFields` in `store/state.ts` extend the same
type rather than restating it.

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
effect radii, offsets and stroke-effect widths, and a brush anchor's width all live in the node's own
units and are scaled by the transform chain, exactly like the geometry — the
renderer applies `node.transform` and *then* sets `ctx.lineWidth`. So a node's
stored `strokeWidth` is not its rendered thickness unless its world matrix has
unit scale.

The consequence for editing operations: baking a transform into anchors while
copying those fields verbatim silently rescales every one of them. An operation
that flattens a transform must either scale the lengths to match or keep the
space it took the style from. See [path-commands.md](reference/path-commands.md) for how
each shape command handles this.
