# Document model

`Document` is the complete persisted drawing state. Editor state such as the
active tool, selection, viewport and undo history does not belong in the file.

## Invariants

- Every key in `shapes` equals that shape's `id`.
- `order` contains each persisted shape id exactly once and is back-to-front.
- Shapes absent from `order` are not part of the document.
- Every key in `groups` equals that group's `id`.
- A shape's `groupId` references its immediate group or is null.
- A group's `parentId` references its immediate parent or is null.
- Group parent references form a forest: dangling references and cycles are invalid.
- Members of a group occupy one contiguous block in `order`.
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

Rendering, bounds, hit-testing, snapping, editing and export must all use the
same composed matrix. A partially applied transform is invalid document state.
