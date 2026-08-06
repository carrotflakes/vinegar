# Path commands

Status: **reference** for the shipped `path.*` / `structure.*` shape commands
(`commands/registry.ts` → `store/structureSlice.ts` → `model/path/*`).

Every one of these rewrites the scene tree, and they share a handful of
conventions that are easy to get wrong because the type system does not express
them. This is that shared part; the per-command detail lives in the model
functions' own doc comments.

## The family

Grouped by what they change. "N→1" etc. counts *nodes*, not contours.

| Command | Shape | Geometry | Result transform |
| --- | --- | --- | --- |
| `structure.convertToPath` | 1→1 | unchanged (parametric → anchors) | kept, with the id |
| `path.simplify` / `smooth` / `flatten` / `reverse` | 1→1 | rewritten per subpath | kept |
| `path.cut` | 1→1 | contours severed at the selected anchors | kept |
| `path.join` | N→1 | **welds** open ends within `JOIN_TOLERANCE` | baked to identity |
| `path.combine` | N→1 (groups flatten) | unchanged (pure re-containering) | **backmost input's** |
| `path.splitSubpaths` | 1→group of N | unchanged | group takes the source's |
| `path.union` / `subtract` / `intersect` / `exclude` | N→1 | recomputed (Clipper/paper) | baked to identity |
| `path.divide` | N→group of faces | recomputed | baked to identity |
| `path.outlineStroke` | 1→1, or 1→group of 2 | stroke becomes a filled outline | baked to identity |
| `structure.makeCompound` / `releaseCompound` | N→1 / 1→N | unchanged | identity container, children keep theirs / the container's is multiplied into each child |

### What `path.combine` accepts

Beyond sibling paths, an input may be a **rect / ellipse / line** (converted by
`convertShapeToPath`, which reproduces their geometry exactly) or a **group**,
which contributes every leaf below it in paint order — so a `splitSubpaths`
result goes back in one step instead of re-selecting the pieces. Leaves nested
inside a selected group are re-expressed in the surviving parent's space.

A **brush** is refused: its path form is either a centerline (losing the varying
width) or an envelope outline (a different shape than the one drawn), so neither
is "unchanged geometry". A group is all-or-nothing — one non-combinable leaf
(including an instance or a compound path) disables the command for the whole
selection. A consumed group's opacity is folded into the result, which composites
its flattened contents the same way; its blend mode and effects are dropped.

**Hidden and locked members are refused** (with a toast, like the mask case).
The result is one node with one `hidden`/`locked` flag, so a hidden member would
reappear visible in it and a locked one would be consumed by the very edit its
lock exists to prevent. Selecting a group whose contents carry those flags is
the easy way to hit this, since the flags then sit below the selection.

## Shared conventions

**Style comes from the backmost input.** Every N→1 op (`join`, `combine`,
boolean, `makeCompound`) takes fill / stroke / stroke details / opacity /
blendMode from `shapes[0]`, where callers pass the inputs in **sibling
(back-to-front) order** — not selection order. This matches Inkscape and
Illustrator's compound path. `path.divide` is the exception: each face is styled
by the **frontmost** input covering it, because that is what was visible there.

**Inputs must share a parent.** N→1 ops require one parent so the result has one
coordinate space, and the result takes the **backmost member's slot** among the
surviving siblings, preserving paint order relative to everything unselected.

**Effects are dropped, with a toast.** An effect stack composites the node as a
whole, so it cannot be split across pieces or merged across inputs and stay
faithful; ops drop them and call `notifyEffectsRemoved()` when any input had
some. `path.splitSubpaths` is the exception — its group *can* carry the source
stack, so nothing is lost and nothing is reported.

**Generator links are dropped** whenever geometry stops matching the
generator's output.

**Bake or keep the transform?** Ops that *recompute* geometry (boolean, divide,
outline) work in the shared parent space, so an identity result is natural.
Ops that only *re-container* geometry have no such excuse, and baking is
actively wrong for them: see the node-local length rule below. `path.combine`
therefore keeps the backmost input's transform and maps the other inputs into
it. `path.join` still bakes — a known inconsistency, since it changes the line
weight of a scaled input (TODO).

**Node-local lengths do not survive baking.** `strokeWidth`, `strokeDash`,
effect radii/offsets and brush widths are all in node-local units that the
renderer scales through the transform chain (`ctx.transform(...node.transform)`
then `ctx.lineWidth = node.strokeWidth`). Baking a transform into anchors and
copying the style fields verbatim silently rescales all of them. Either keep the
space, or scale the lengths deliberately.

## The clipping-mask rule

A clip group's mask is its **frontmost child** (`clipsToMask: true`, see
[document-model.md](document-model.md)). Nothing in the types says so, so any op
that turns one node into several must think about it:

- Replacing the mask with **several shapes** leaves the frontmost piece masking
  and silently demotes the rest to clipped *content*. The tree stays valid, so
  no validator catches it. `path.splitSubpaths` and
  `structure.releaseCompound` refuse instead, via `maskMultiNodeError`.
- Replacing the mask with a **group** (split's normal result, outline-stroke's
  fill+outline pair, divide's faces) makes the clip invalid, because a group is
  not an `isClippingMaskCandidate`. `hasValidSceneContainers` then rejects the
  whole transaction — correct, but currently silent for `outlineStroke` and
  `divide` (TODO).
- Merging the mask **into** another node (`path.combine`) leaves the group
  without a mask or without content. Refused the same way.
- A 1→1 replacement is always safe, which is why releasing a single-child
  compound mask stays allowed.

## Compound-path children

`compoundPath.childIds` accepts areal leaves only — `rect`, `ellipse`, closed
`path` (`isCompoundChild`, enforced by `sceneValidation.ts`). An op that would
insert a **group** under a compound therefore fails validation and no-ops. That
is why `path.splitSubpaths` drops the group and inserts its pieces flat when the
parent is a compound (`flattenSplitPieces`); a compound already owns the
appearance its children's paint fields are ignored in favour of, so nothing is
lost there.

## What the validators do and do not cover

| Check | Runs | Catches |
| --- | --- | --- |
| `hasValidSceneContainers` (`model/sceneValidation.ts`) | structural ops call it before `transact`, and bail out if it fails | frames below the top level, non-areal or empty compound children, and (via `hasValidClippingMasks`) a clip group whose frontmost child cannot be a mask |
| `validateTree` (`io/serialize.ts`) | save / load | missing children, cycles, multiple or missing ownership |

None of them catch a **still-valid but wrong** rewrite: a mask that got replaced
by a different silhouette, or a demoted mask piece that is now painted content.
Ops must guard those themselves, and a scene-tree test is the only way to prove
they do — the reason the mask cases above each have one
(`tests/clippingMaskIntegration.test.mjs`, `tests/splitSubpaths.test.mjs`,
`tests/combinePaths.test.mjs`).
