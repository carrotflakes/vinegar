# Document model

`Document` is the complete persisted drawing state. Editor state such as the
active tool, selection, viewport and undo history does not belong in the file.

## Invariants

- Every key in `nodes` equals that shape or group's `id`.
- `rootIds` and each group's `childIds` are back-to-front and are the only
  persisted sources of hierarchy and paint order.
- Every node is owned exactly once by either `rootIds` or one `childIds` list.
- Missing children, multiple ownership, duplicate ownership, cycles and
  unreachable nodes are invalid. Empty groups are valid.
- Parent ids, ancestors, depth, leaf shapes, inherited visibility/locking and
  world matrices are derived by the Scene Index and are not persisted.
- Asset-bearing nodes reference entries in `assets` by id; binary data does not
  belong directly in a node. `image` nodes and `pattern` fills/strokes both
  reference an image asset; an asset survives save only while something still
  references it (see `referencedAssetIds`).
- `fill`/`stroke` are a `Paint` union: `solid`, linear/radial `gradient`, or a
  `pattern` (an image asset tiled in the shape's local space, placed by
  `scale`/`rotation`/`offset`). A pattern that references a decoding/missing
  asset simply paints nothing that frame.
- Extension data uses namespaced keys in `extensions` and must be JSON-safe.
- Compound paths are single scene nodes. Their closed source shapes are stored
  inline in `components`, are not independently selectable, and are painted
  once with the compound path's shared appearance using the even-odd rule.
- Text is a leaf shape, not compound-path geometry. Point text stores its
  measured width; area text stores its fixed wrapping width; both store the
  measured auto-height so bounds and hit-testing never need a live font.
  Typography is one style per node (`fontFamily`, size, weight, italic,
  line-height and alignment); line layout is derived from the text at render.

The file wrapper version is deliberately strict. The current version is v14;
supported older versions are migrated before validation. Changing the
persisted shape of `Document` requires bumping `CURRENT_FILE_VERSION`.

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
