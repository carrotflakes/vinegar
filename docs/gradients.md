# Gradients

A gradient fill or stroke is a **unit-space ramp plus a matrix**. Everything about where a gradient sits —
its start and end points, its ellipse, whether it follows a resize — folds into that matrix, so a renderer
only has to know how to draw three ramps and how to apply a transform.

## The unit ramps

| kind     | ramp parameter `t`                     | drawn in unit space as               |
| -------- | -------------------------------------- | ------------------------------------ |
| `linear` | `x` of the unit square                 | `(0,0)` → `(1,0)`                    |
| `radial` | distance from the origin               | `1` at the unit circle               |
| `conic`  | angle around the origin, one turn = `1` | `0` at `+x`, increasing clockwise    |

`gradientMatrix(paint, bounds)` maps that space into the shape's **local** space. Its columns are the two
gradient axes: the first runs `start` → `end`, the second is that vector's perpendicular scaled by `ratio`.
Both are mapped through the paint's own space first:

- `space: "bounds"` — `start`/`end` are `0..1` of the shape's fill bounds, so the gradient follows (and is
  squashed by) a resize. This is the default and matches SVG's `objectBoundingBox` / Figma's behaviour.
- `space: "local"` — `start`/`end` are shape-local user units; the gradient stays put when the shape is
  reshaped, like Illustrator's annotator. Dragging an axis with the gradient tool always produces this.

`focal` is the radial focal point in **unit-circle coordinates** (`{x:0,y:0}` is the centre), so it rides
along with the ellipse. `spread` is SVG's `spreadMethod`; a conic ramp wraps by construction and ignores it.

## What backends cannot do themselves

Two features have no native form anywhere, so `renderStops(paint)` bakes them into extra stops and every
backend consumes that one expanded ramp:

- **Stop midpoints** — `midpoint` is where the blend to the *next* stop reaches its halfway colour
  (Illustrator's diamond). It becomes an exponent: `u = t^(ln 0.5 / ln m)`.
- **`interpolation: "oklab"`** — perceptually even blending, sampled with `mixHex` from `model/color.ts`.

`SEGMENT_SAMPLES` interior samples per affected segment is the accuracy/size trade-off.

## Rendering

`canvas/render/gradient.ts` picks the cheapest correct route:

| case                                        | how                                                            |
| ------------------------------------------- | -------------------------------------------------------------- |
| linear, any matrix                          | `createLinearGradient` — a linear ramp survives any affine map  |
| radial/conic when the matrix is a similarity | `createRadialGradient` (focal included) / `createConicGradient` |
| radial/conic otherwise (ellipse, shear)     | rasterised offscreen, returned as a `CanvasPattern` with the matrix in `setTransform` |

Those rasters are cached per context in a small LRU keyed by **what they contain** — the paint's colours and
geometry, the matrix, the rect and the pixel size — never by the paint object's identity. Documents are
immutable, so an unrelated edit or an undo hands the renderer fresh paint objects for artwork that has not
changed, and identity keys would re-render a full-size offscreen canvas for every one of them.

The raster covers the shape's bounds plus `overflow`, which callers pass as `strokeOutset(shape)`: a stroke
is laid out over the geometry bounds but paints outside them, and a wide one would otherwise run off the
raster and fade to nothing. `spread: repeat`/`reflect` is reproduced by tiling the stop list across the cycle range
the shape actually covers (`cycleRange` + `tiledStops`) — Canvas has no spread mode of its own.

SVG export is exact for linear and radial: the same matrix goes out as `gradientTransform` over a unit-space
def (`x1=0 x2=1`, or `cx=cy=0 r=1` plus `fx`/`fy`), with `spreadMethod` verbatim. Conic has no SVG paint
server, so it is approximated by a one-tile `<pattern>` of `CONIC_WEDGES` flat wedges.

SVG **import** reads Paper's `origin`/`destination`/`highlight` into a `local` gradient.

## Editing

Both editors call the same helpers in `model/gradient.ts` (`withGradientAngle`, `withGradientLength`,
`withGradientSpace`, `addStopAt`, `updateStop`, `removeStop`, `reverseStops`), so a panel edit and a canvas
drag mean the same thing.

- **Panel** (`ui/controls/GradientEditor.tsx`) — kind, ramp track with draggable stops and midpoint
  diamonds, angle/length, aspect, focal point, spread, blending and placement.
- **Gradient tool** (`canvas/tools/gradientTool.ts`, shortcut ⇧G) — drag across a shape to place an axis
  (turning a solid fill into a gradient), then drag the annotator: a round origin, a square end, an orange
  aspect knob and focal dot, and stop chips riding a gutter beside the axis so they never sit under the
  endpoint handles. Double-clicking the ramp adds a stop; Shift constrains the axis to 15°.
  `canvas/gradientHandles.ts` builds that geometry once for the painter, the hit test and the drag.
  A press that never travels past `CLICK_SLOP` is a click, not a zero-length axis.

The tool edits the fill or the stroke, whichever `store/gradientToolStore.ts` has focused; the bar at the
bottom of the canvas (`canvas/GradientBar.tsx`) switches that, the kind, and the selected stop's colour.
