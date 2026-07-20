# Compound paths as real nodes (plan)

Status: **implemented** (2026-07-20). File version: **v22**. Depends on
[path-unification.md](path-unification.md) (children use the unified `path`
type).

## Problem

`CompoundPathShape` stores its source shapes inline in `components:
PrimitiveShape[]` — the only place where hierarchy lives outside
`nodes`/`childIds`. Consequences:

- Components are invisible to the Scene Index, layers panel, node tool,
  copy/paste id machinery and `validateTree`; `serialize.ts` needs a parallel
  validator (`COMPOUND_COMPONENT_TYPES`, recursive `isNode` on components).
- Component geometry is frozen: "not node-editable" is a modeling limitation,
  not a product decision (Illustrator's compound-path members stay editable).
- Every traversal/migration must special-case the nested array
  (`migrateLegacyPaints` already does).

## Decision

Make the compound path a **container node**, structurally like `Group` but
painted as one shape:

```ts
interface CompoundPathNode extends BaseShape {
  type: "compoundPath";
  /** Real child node ids, back-to-front. Non-empty. */
  childIds: string[];
}
```

- **Children are real scene nodes** owned by the compound's `childIds`; the
  "hierarchy lives in childIds only" invariant becomes exception-free.
- **Geometry**: the union of each visible child's outline (child local
  geometry × child transform), filled with the **even-odd** rule. The
  `fillRule: "evenodd"` field is dropped — the type implies it (children keep
  their own `fillRule` field from unification, ignored while inside).
- **Appearance lives on the container**: `fill`/`stroke`/stroke details/
  opacity/blend/effects of the compound apply to the combined outline.
  Children's paint fields are retained but ignored (same rule the clip-group
  mask already uses). Release re-applies fill/stroke/stroke details/opacity/
  blend to the freed children and restores their retained effects; container
  effects are removed with the same notification used by Ungroup because
  applying them independently would not preserve the combined appearance.
- **Allowed children**: areal leaf shapes only — `rect`, `ellipse`, closed
  `path`. No groups, instances, text, images, brushes, lines or nested
  compounds; "Make Compound Path" keeps flattening nested compounds into
  their children. Child `hidden` excludes that child's outline; child `locked`
  is inert while the compound is selected atomically.
- **Selection stays atomic** in the canvas: clicking resolves to the compound
  node exactly like clicking into a group resolves to its outermost container.
  The **node tool** may target child `path` anchors through the compound
  (the main payoff); rect/ellipse children remain parametric until released.
- **Layers panel** shows the compound like a group row with nested children
  (rename/hide/reorder children = reorder outlines); drag-and-drop into a
  compound is restricted to allowed child types, per docs/drag-and-drop.md
  conventions.

## Migration (v21 → v22, on load)

- For each compound: move every `components[i]` into `doc.nodes` and list its
  id in `childIds` in the same order. Component transforms are already
  compound-local (Make bakes the source's parent-space transform in), so they
  transfer unchanged.
- Component ids exist and are file-validated but not globally reserved:
  re-id on collision with any existing node id.
- Drop the `fillRule` field; `components` disappears.
- Validation: `isNode` for `compoundPath` becomes childIds-shaped (like
  `group`); `validateTree` walks compound children and enforces the allowed
  child types + closed-path rule + non-empty `childIds`.

## Work plan

1. **Types**: replace `CompoundPathShape` with `CompoundPathNode`; it leaves
   the `Shape` leaf union conceptually — audit `isShape`/`Shape` usages and
   introduce shared helpers in `scene.ts` (`isContainer(node)`,
   `childIdsOf(node)`) so group-only traversals become container traversals.
2. **Scene Index** (`scene.ts`): traverse compound children for
   parent/depth/ancestors/world/owner, but keep the **compound itself** in
   `shapeIds` (paint order leaf) and keep children out so nothing paints or
   picks them independently.
3. **Geometry**: `bounds.ts`, `hitTest.ts`, `boolean.ts`, `clippingMask.ts`,
   `outlineStroke.ts`, `bucketFill.ts` build the combined outline from
   children instead of `components` (shared "compound outline" helper).
4. **Render / export**: `canvas/render.ts` gathers children into one Path2D
   (evenodd + container appearance); `exportSvg.ts` emits one `<path>` from
   the children's subpaths with `fill-rule="evenodd"`.
5. **Structure ops**: `compoundPath.ts` Make = create container + reparent
   selection under it (flattening nested compounds); Release = ungroup-style
   expansion applying container appearance (reuse group machinery in
   `groups.ts`/`structureSlice.ts`). Delete/duplicate/copy-paste reuse the
   group deep-copy path — verify id-remapping covers compound children.
6. **Editing**: node tool resolves anchor targets through compounds for
   `path` children; select tool keeps atomic resolution.
7. **UI**: layers panel nesting + drop-target restrictions; properties panel
   sections that special-case `compoundPath` (Appearance, SelectionActions).
8. **IO**: v22 migration + validators; `CURRENT_FILE_VERSION = 22`;
   `importSvg.ts` creates container + child nodes.
9. **Demo & docs**: rebuild the demo compound; update
   `docs/document-model.md` (compound-path invariant bullet) and README.

## Verification

- Open a v21 file with compounds: identical rendering/hit-testing; layers
  panel shows nested children; undo/redo across Make/Release.
- Node-edit a child path anchor inside a compound; hide a child (outline
  drops out); reorder children.
- Release restores independently painted shapes with the compound's
  appearance (parity with today's behavior).
- Copy/paste and duplicate produce fully re-id'd deep copies.
- SVG import/export round-trip; boolean ops and bucket fill treat compounds
  as even-odd regions as before.
