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
  belong directly in a node.
- Extension data uses namespaced keys in `extensions` and must be JSON-safe.

The file wrapper version is deliberately strict. Only the current version is
loaded; changing the persisted shape of `Document` requires bumping
`CURRENT_FILE_VERSION`.

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
