# Path unification (plan)

Status: **implemented** (decided and completed 2026-07-20). File version:
**v21**. Prerequisite for [compound-path-nodes.md](compound-path-nodes.md).

## Problem

The model has five "vector outline" shape types with overlapping powers:

| type | structure | fill rule | still produced by |
| --- | --- | --- | --- |
| `path` | `points: Vec2[]` + `closed` | nonzero | script API, demo doc (pencil uses it only as a live preview, then converts to `bezier`) |
| `bezier` | `subpaths: BezierSubpath[]` | nonzero | pen tool, boolean ops, pencil finish, SVG import |
| `polygon` | `polys: Vec2[][][]` | evenodd | bucket fill, Outline Stroke |
| `compoundPath` | retained `components` | evenodd | Make Compound Path, SVG import |
| `brush` | centerline anchors + width | (envelope) | brush tool |

`path` is a `bezier` whose anchors all have `null` handles; `polygon` is a
multi-subpath `bezier` with straight segments and the even-odd rule; `bezier`
already expresses compound (hole-cutting) outlines. Every consumer that
switches on shape type (13 files: bounds, hit-test, transforms, stroke,
boolean, render, SVG export, …) pays for the duplication, and fill rules are
hardcoded per type (`render.ts`/`clippingMask.ts`: polygon & compoundPath ⇒
evenodd, everything else ⇒ nonzero).

## Decision

Merge **`path` + `polygon` + `bezier` into a single canonical `"path"` type**:

```ts
interface PathShape extends BaseShape {
  type: "path";
  subpaths: PathSubpath[];       // renamed from BezierSubpath, same structure
  /** Winding rule for fill/hit/clip. Absent = "nonzero". */
  fillRule?: "nonzero" | "evenodd";
}

interface PathSubpath {
  anchors: PathAnchor[];         // { p, hIn, hOut } — null handle = corner
  closed: boolean;
}
```

Kept as-is: `rect`, `ellipse`, `line` (distinct creation/editing UX and
parametric meaning), `brush` (carries a width profile), `image`, `text`.
`compoundPath` survives v21 unchanged except its `components` become the new
types; its redesign is the follow-up plan.

The `"path"` type string is reused deliberately: pre-v21 `"path"` (polyline)
is distinguishable by file version and converted on load, so there is no
ambiguity inside a validated document.

Explicitly out of scope here: `line` unification, moving paint fields off
`BaseShape`, per-subpath fill rules.

## Semantics (unchanged behaviors, now data-driven)

- **Fill**: paint all subpaths as one even-odd/nonzero region per `fillRule`;
  open subpaths are implicitly closed for filling (current behavior).
- **Stroke**: trace each subpath; open subpaths stay open. Stroke alignment
  remains effective only for closed geometry.
- **isAreal / fillable**: any subpath with ≥ 2 anchors (current `bezier` rule).
- **Boolean ops**: read the shape with its own `fillRule` (today this is the
  polygon/evenodd special case); output keeps producing curves, now labeled
  `type: "path"` with `fillRule` absent (paper.js returns properly wound
  nonzero output).
- **Node tool**: already edits `bezier` anchors incl. null handles; straight
  former-polyline/polygon geometry becomes editable for free.

## Migration (v20 → v21, on load in `io/serialize.ts`)

- `bezier` → `type: "path"` (rename only; `fillRule` stays absent = nonzero).
- old `path` → one subpath: `anchors: points.map(p => ({ p, hIn: null,
  hOut: null }))`, `closed` carried over.
- `polygon` → `fillRule: "evenodd"`, one **closed** straight subpath per ring
  of `polys.flat()` (ring order between outer/holes is irrelevant under
  even-odd; this matches today's flattened rendering exactly).
- `compoundPath.components` migrated recursively with the same rules.
- Validation: drop `polygon` from `NODE_TYPES` / `COMPOUND_COMPONENT_TYPES`,
  validate `fillRule`, keep the closed-components rule for compounds.

Memory note: dense polygons (bucket fill can emit hundreds of points) grow
~3× as `{p, hIn: null, hOut: null}` anchors. Accepted; the planned bucket-fill
curve re-fitting (TODO) shrinks these, and rendering can keep a fast
`lineTo` path when both handles are null.

## Work plan

1. **Types**: replace the three types in `model/types.ts`; update
   `PrimitiveShape` (`rect | ellipse | line | path`) and `ShapeType`.
2. **Geometry helpers**: `bounds.ts`, `hitTest.ts`, `transforms.ts`,
   `stroke.ts` (incl. `strokeOutset`), `snap.ts`, `boolean.ts`
   (`shapeToGeom`/`isAreal` collapse to one case), `clippingMask.ts`
   (`shapeFillRule` reads the field), `outlineStroke.ts`, `bucketFill.ts`,
   `roundedRectSubpath` callers, `bezier.ts` editing helpers (rename to match).
3. **Producers**: pencil finish (`shapeTools.ts` — preview can build the new
   type directly), pen tool, bucket tool (`type: "path"`, evenodd, straight
   closed subpaths), Outline Stroke (`structureSlice.ts`), boolean output,
   `runScript.ts`/`scriptWorker.ts` — the experimental scripting API accepts
   canonical `path(subpaths, fillRule?)` data directly (legacy
   `path(points, closed)` compatibility was intentionally dropped), SVG import.
4. **Consumers**: `canvas/render.ts` (fill rule from the field; null-handle
   fast path), `canvas/nodes.ts` + `nodeTool.ts`, `picking.ts`, `overlay.ts`,
   `exportSvg.ts` (`fill-rule` attribute from the field), properties panels
   (`AppearanceSection`, `SelectionActionsSection`, `PropertiesPanel`),
   `shapeSlice.ts`, eraser (brush-only today — verify no path assumptions).
5. **IO**: v21 migration + validators as above; `CURRENT_FILE_VERSION = 21`.
6. **Demo**: rebuild `createDemoDocument.ts` shapes with the new type.
7. **Docs**: update `docs/document-model.md` (shape inventory, fill-rule
   invariant; also fix its stale "current version is v19" note) and README
   where shape types are named.

## Verification

- Open a v20 demo/save: former path/polygon/bezier render identically
  (fill rule, dashes, stroke alignment) and hit-test the same.
- Boolean ops, bucket fill, Outline Stroke, pencil, pen, script `path()`
  each produce the unified type and stay node-editable.
- SVG export parity (fill-rule attribute) and SVG import round-trip.
- Old-file compound paths still validate (components migrated).
