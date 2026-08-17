# Clipping masks

Status: **shipped.** No dedicated file-format field beyond `Group.clipsToMask`.
Related: [../document-model.md](../document-model.md) (the model rule),
[../reference/path-commands.md](../reference/path-commands.md) (the
clipping-mask rule every shape op must respect),
[../reference/scene-traversal.md](../reference/scene-traversal.md),
[../reference/render-performance.md](../reference/render-performance.md)
(masks force isolation layers).

## The rule, in one line

A `Group` with `clipsToMask: true` uses its **frontmost child** as a vector clip
and paints only the children before it.

Everything awkward about clipping masks follows from that being a *position*
rather than a flag. There is no `isMask: true` on the mask node, so:

- The mask cannot be identified by looking at it — only by looking at its parent.
- Any operation that turns one node into several silently changes which node is
  the mask, without producing an invalid tree.
- Reordering children reassigns the mask.

That choice matches Illustrator/Inkscape/SVG authoring habits and keeps the node
types free of a field only groups care about, but it is the reason
[path-commands.md](../reference/path-commands.md) has a whole section on ops that
must refuse.

`clipsToMask` is deliberately **not** named `clip`: it and the frame's
`clipsContent` used to share that name with *opposite* defaults, which read as
the same thing and were not.

## What can be a mask

`isClippingMaskCandidate` (`src/model/clippingMask.ts`) — area-bearing vector
geometry only:

| Type | Accepted when |
| --- | --- |
| `rect`, `ellipse` | non-zero width and height; with an active modifier stack, judged on the resolved contours instead (a modifier can hollow the silhouette out entirely) |
| `path` | at least one subpath with ≥ 2 anchors, resolved through the modifier stack. **Open paths qualify** — clipping implicitly closes them, exactly as fill does |
| `compoundPath` | non-empty, and every child is itself a candidate |
| `line`, `image`, `text`, `brush`, `group`, `instance`, `frame` | never |

The mask's `fillRule` decides what is inside; its own paint, opacity and
`hidden` flag are **preserved but ignored** while it supplies clip geometry.

## Validity

A clipping group needs a valid frontmost mask *and* at least one content child
(`clippingMask` returns `null` below two children). `hasValidClippingMasks` is
part of `sceneContainerViolation`, so `acceptsScene` (`store/sceneGuard.ts`)
rejects any transaction that would leave a clip group without a usable mask —
silently, unless developer mode is on. Commit through the guard, never around it.

Helpers, all in `src/model/clippingMask.ts`:

| Helper | Answers |
| --- | --- |
| `isClippingGroup(node)` | is this group flagged as clipping? |
| `clippingMask(doc, group)` | the *effective* mask node, or `null` for an ordinary or malformed group |
| `clippingContentIds(doc, group)` | the painted children (all of them for an ordinary group) |
| `isClippingMaskNode(doc, id)` | is this node its parent's active mask? |
| `clippingMaskAncestors(doc, id, boundaryId?)` | active masks enclosing a node, nearest first |
| `canMakeClippingMaskSelection` / `canReleaseClippingMaskSelection` | command `enabled` predicates |

## Traversal

Readers never split the mask out themselves. `containerContents`
(`model/sceneWalk.ts`) returns a group's `childIds` **already excluding** the
mask, plus the mask beside it:

```ts
const mask = clippingMask(doc, node);
return { kind: "group", childIds: mask ? clippingContentIds(doc, node) : node.childIds, mask };
```

That is why a mask's own blend mode cannot drag its group onto an isolation
layer (`subtreeBlends` walks `containerChildIds`, which the mask is not in), and
why a reader that re-derives children from `node.childIds` directly will paint
the mask as if it were art.

## Rendering (`canvas/render/scene.ts`)

Two paths, chosen per group:

1. **Path clip** (the normal case) — `ctx.clip(maskPath, fillRule)` on the
   target, with the mask's transform baked into a `Path2D` via `DOMMatrix`.
   There is a `tracePath` fallback for environments without `Path2D.addPath`.
2. **Alpha pass** — the group isolates onto a layer, its content paints
   unclipped, then the mask is filled over it with
   `globalCompositeOperation = "destination-in"`.

The second path exists because of a real device bug: **Chrome on Android drops
an advanced blend mode entirely once the enclosing path clip's device bounds
pass the driver's limit** (zooming into the demo document's clipped "MASKED"
text made it vanish). So when `subtreeBlends(doc, childIds)` finds any
non-normal blend under the group, the mask becomes alpha instead of a clip.
Blend modes on *effects* do not count — those composite inside the node's own
isolation layer, below the clip.

A clipping group is one of the four reasons a node needs a temporary layer at
all (opacity, blend, mask, effects); see
[../reference/render-performance.md](../reference/render-performance.md).

## Hit-testing (`model/geometry/hitTest.ts`)

- A leaf is only hit if the point also lies inside **every** enclosing mask —
  `pointPassesAncestorMasks` over `clippingMaskAncestors`, tested with
  `hitTestClippingMask`, which uses the mask's fill area regardless of its paint.
- `clipBoundaryId` stops that walk at a given ancestor: focused-subtree hit
  testing retains masks at and below the focus root and ignores masks above it,
  matching what focus mode actually renders (see [focus.md](focus.md)).
- A mask's **own** `hidden` flag does not hide it from hit-testing
  (`isNodeVisibleForHitTesting`) — it is still selectable geometry — but a hidden
  *ancestor* does.
- Once the user has drilled into a clip group (`activeGroupId`), `picking.ts`
  moves the mask to the front of the candidate list so it can be grabbed and
  reshaped.

## Commands (`store/structureSlice.ts`)

- **Make clipping mask** (`structure.makeClippingMask`) — wraps ≥ 2 sibling
  selection roots in a new `"Clip Group"` with `clipsToMask: true`, at the
  frontmost member's slot. Refused when the roots do not all share one parent,
  when the frontmost of them is not a mask candidate, when
  any root is a frame (frames are top-level only, so the wrap would produce a
  document `transact` refuses), or when the selection includes the parent clip
  group's own mask.
- **Release clipping mask** (`structure.releaseClippingMask`) — ungroups valid
  clip groups; the mask becomes an ordinary sibling again. Group-level effects
  are dropped, and the user is told via `notifyEffectsRemoved`.

## SVG interop

Export emits a `<clipPath clipPathUnits="userSpaceOnUse">` per mask and
references it with `clip-path` on the group; nested masks nest. The same
construction is reused for outside/inside stroke alignment, where the shape's
silhouette clips its own doubled stroke. Import maps Paper.js clipping groups
back to `clipsToMask` groups.
