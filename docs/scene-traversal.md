# Scene traversal

Several parts of the editor walk the scene tree recursively in paint order. What
they *do* at each node is completely different; how they **descend** is not.
`src/model/sceneWalk.ts` owns the descent.

## Why it is one function

The descent has three parts, and every reader needs all three:

1. **Effective children.** A group's are `childIds` — unless it is a clipping
   group, where the mask is a sibling that confines the others rather than being
   painted with them. A frame's are `childIds`. An instance's are its symbol
   definition's root. A shape has none.
2. **Confinement.** A clipping group is bounded by its mask shape; a frame by
   its content box, but only when `clipsContent` is set.
3. **Symbol recursion.** An instance whose symbol is already being expanded is a
   cycle and must not be descended.

Each reader used to re-derive all three. They drifted, and the drift was
invisible — a reader that falls through on a node type silently produces nothing
for it rather than failing:

- **SVG export** dispatched on group and instance only, so every frame and its
  whole subtree exported as an empty `<g>` (fixed in `b5a288f`).
- **Bucket fill** had the same gap: content inside a frame contributed no ink, so
  a click inside framed artwork found no boundary and reported open space.

Both were live bugs found by listing the readers, not by anyone hitting them.

## The API

```ts
containerContents(doc, node, activeSymbols?): ContainerContents | null
containerChildIds(doc, node, activeSymbols?): string[]
```

`null` means there is nothing to descend into: a leaf, a dangling symbol
reference, or a cycle. Otherwise `childIds` is the back-to-front list, and the
`kind` discriminant carries what the container adds — `mask` for a group,
`frame` for a frame, `symbolId` for an instance.

`activeSymbols` is the caller's expansion stack. **A reader that descends into
instances must maintain one**: add `symbolId` before recursing, delete it after.
Passing it is what stops a cyclic symbol from recursing forever.

`containerChildIds` is the short form for a reader that treats every container
alike and needs no confinement or symbol bookkeeping.

## Who uses it

| Reader | File |
| --- | --- |
| Canvas renderer | `canvas/render/scene.ts` — `paintNodeInternal`, `subtreeBlends` |
| Layer sizing / culling bounds | `canvas/render/bounds.ts` — `nodeLocalContentBounds`, `visualNodeWorldBounds` |
| SVG export | `io/exportSvg.ts` — `nodeToSvg`, `usesBlend` |
| Bucket fill obstacles | `model/bucketFill.ts` — `collectObstacles` |

## Who deliberately does not

Two places answer a different question, and unifying them would be a false
merge. Neither is a copy of this descent that drifted.

**Hit-testing and export bounds** (`model/geometry/hitTest.ts`,
`canvas/picking.ts`, `io/exportBounds.ts`) work from a *flattened leaf list*
(`symbolLeafIds`, `scopeLeafIds`, `shapesInPaintOrder`) and then walk **upward**
through ancestors to apply masks. That is a different algorithm, chosen because
they need a front-to-back answer about one point rather than a full paint.

**`model/geometry/bounds.ts` `nodeWorldBounds`** computes a *selection* AABB, not
a painted extent. A frame is its own content box whether or not it clips; a
clipping group is its mask's box rather than `children ∩ mask`. Those are
deliberate model answers that differ from what gets painted.

## Confinement applies everywhere, not just when painting

A `clipsContent` frame confines its subtree the same way a clipping group's mask
does, so every reader that asks "what area does this cover" has to intersect
against it:

| Reader | Against a clipping mask | Against a `clipsContent` frame |
| --- | --- | --- |
| Renderer | `ctx.clip()` on the mask path | `ctx.clip()` on the content box |
| SVG export | `clip-path` from the mask shape | `clip-path` from the content box |
| Render bounds | `children ∩ mask` | the frame box alone |
| Bucket fill ink | content ∩ mask silhouette | each entry ∩ the box |
| Export crop | leaf box ∩ ancestor masks | leaf box ∩ ancestor frame boxes |

The two clip forms are **not** interchangeable in bucket fill. A clipping group
merges its content into one silhouette and turns covers off inside it, because a
composite ink shape cannot be partially excluded. A frame is an ordinary
container — an artboard — so it crops each ink entry on its own and covers keep
working, which is what lets you bucket-fill a shape that sits inside an artboard.
Cropping can pull a cover's area off the click point, so the cover flag is
re-checked against the cropped contours rather than carried across.
