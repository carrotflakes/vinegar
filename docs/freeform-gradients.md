# Freeform gradients

A freeform gradient is a paint defined by **scattered colour points** instead of a ramp: drop colours
where you want them and the space between is filled in by interpolation. It is the Illustrator
"freeform gradient" shape of thing, built on plain scattered-data interpolation.

`model/freeform.ts` owns the whole thing — the type, the editing helpers and the field itself.

## The field

The colour at a position is a **weighted average of every point**, weighted by distance:

| `method`   | weight                | character                                                                |
| ---------- | --------------------- | ------------------------------------------------------------------------ |
| `shepard`  | `weight / dᵖ`         | Inverse distance weighting. Passes exactly through each point's colour; `falloff` is the exponent `p` (1 = broad wash, 4+ = hard cells with visible boundaries). |
| `gaussian` | `weight · e^-(d/r)²`  | Normalised radial basis. Smoother and hazier, does not reproduce a point's colour exactly; `falloff` is the radius `r`. |

Both are **normalised** — the weights are divided by their sum — so every result is a convex blend of
the point colours. The field can never leave the gamut the artist picked, however the points are
arranged, and it is defined everywhere on the plane (no "outside the gradient" case to design for).
Two details make that true in the corners:

- Exactly on a Shepard point the sum diverges, so that point's colour is returned directly.
- When every gaussian kernel underflows to zero (a tiny radius, far from everything) the nearest
  point wins, rather than a `0/0`.

Colours are blended **premultiplied by alpha**, so a transparent point fades its surroundings out
without tinting them. `interpolation` picks the space the channels are averaged in (`oklab` by
default here, unlike a ramp — a scattered blend crosses many more colour pairs, and sRGB muddies
them). Each point also carries a `weight` (the "Spread" control): a relative multiplier on its
influence, so one colour can dominate without being moved.

## Placement

`space` is the gradient vocabulary, unchanged: `bounds` puts point positions in `0..1` of the shape's
fill bounds (the field follows a resize), `local` puts them in shape-local user units (pinned).

`withFreeformSpace` converts the points and scales a gaussian radius by the mean of the two axes. On
a **non-square** shape the picture cannot survive that switch exactly, and no conversion could make
it: bounds space measures distance in the normalised box, so the field is stretched with the shape,
while local space measures true distance. The points keep their places; the blend un-squashes. A
Shepard exponent is unitless and travels unchanged; only a gaussian radius is a length, and only the
exponent has an upper bound (`clampFalloff`).

## Rendering

Nothing in Canvas or SVG can draw a scattered field, so `freeformRaster` evaluates it per pixel —
the one definition of what the paint looks like, shared by the canvas renderer and SVG export so the
two cannot drift.

`canvas/render/freeform.ts` rasterises into an offscreen canvas and returns a `CanvasPattern` placed
over the shape's bounds, the same route the elliptical gradient rasters take (including the
per-context LRU keyed by *what the raster contains* — colours, geometry, rect, pixel size — never by
the paint object's identity, since an unrelated edit hands the renderer a fresh paint object for
unchanged artwork).

The one difference from a ramp raster is **resolution**. A ramp is drawn at device scale because a
hard stop has to stay hard; a freeform field is smooth by construction, so it is rasterised at
`MAX_SIDE` (256) per side at most and left to the canvas's bilinear upscaling. That turns an
`O(pixels × points)` loop into a fixed ~65k-sample cost no matter how far the user has zoomed in.
A very high Shepard exponent is the one case where the cusps at the points are visibly softened by
the upscale; that is the trade the smoothness assumption buys everywhere else.

The raster covers the shape's bounds plus the caller's `overflow` (`strokeOutset`), because a stroke
is laid out over the geometry bounds but paints outside them.

### Cost

A full 256×256 raster costs roughly **6 ms** (Shepard, OkLab, 8 points) to **16 ms** (gaussian, 24
points) — paid whenever the paint changes, so once per frame while a point is being dragged and never
again afterwards. Three things keep it there, and all three are load-bearing:

- `x ** 3` compiles to a `pow` call, so the Oklab→linear cubes are written as multiplications
  (that one change was 14 ms → 6 ms).
- `linearToSrgb255` (in `color.ts`) encodes through a table instead of a `Math.pow` per channel.
- The gaussian kernel and the whole-number Shepard exponents likewise avoid `Math.exp`/`Math.pow`
  per point per pixel (`expNeg`, `powHalf`). A *fractional* exponent still pays for `Math.pow` and
  costs about 4× the default.

The tables are approximations, guarded by tests: the sRGB encode stays within half an output level,
and the tabled kernel within one level of the exact colour.

There is no reduced-quality mode during an interaction yet (see `render-performance.md`), so a drag
re-rasterises at full size every frame.

**SVG export** embeds that raster as an `<image>` inside a one-tile `<pattern>` — SVG has no
scattered-interpolation paint server, the same reason a conic ramp goes out as flat wedges. The tile
is padded past the shape so a stroke lands on real pixels. Without a canvas to rasterise into
(headless export) the paint degrades to `freeformAverage`, its mean colour.

For 20 px swatch previews `freeformToCss` approximates the field with one soft `radial-gradient` blob
per point over that mean; a pinned field has no box to place blobs in and previews as the mean alone.

## Editing

Both editors call the same `model/freeform.ts` helpers, so a panel edit and a canvas drag mean the
same thing.

- **Panel** (`ui/controls/FreeformEditor.tsx`) — a pad showing the shape's box with the *real* field
  drawn behind draggable point chips (this is where the result is judged, so it is not the CSS
  approximation). Click the pad to add a point; the point row edits colour, position, spread and
  removal; below it the method (**Shepard** / **Gaussian**, named for what they are), falloff,
  blending, placement and overall alpha.
- **Gradient tool** (⇧G) — when the target paint is a freeform field the tool switches from ramp
  handles to colour points:

  | gesture | effect |
  | ------- | ------ |
  | drag a point | move it |
  | click on the artwork | add a point, taking the colour already there |
  | **Alt-drag** a point | duplicate it and move the copy, leaving the original |
  | drag the **spread ring** | set that point's `weight` |
  | **Delete** / Backspace | remove the active point |

  Delete belongs to the point through the **command registry**, not a canvas key listener:
  `edit.delete` asks `deleteActiveFreeformPoint` before it deletes anything else, the same way it
  lets a selected guide take the key first. Intercepting the keydown in `useCanvasKeyboard` instead
  would have depended on which window listener was registered first, and lost the race — the shape
  got deleted and the selection went with it. `gradientTargetShape` and the helper live in
  `store/gradientToolStore.ts` so the registry can reach them without importing the canvas layer.
  The last point never goes; Delete then falls through to its usual meaning.

  Alt-drag duplicates because that is what Alt-drag already means for a selection
  (`promotePendingMove`), and like it the copy is made only once the press passes `CLICK_SLOP` —
  so an Alt-*click* cannot leave an invisible duplicate stacked on the original, and the duplicate
  and the move land as one undo step. Removal is on Delete rather than Alt-click precisely because
  Alt is taken: a gesture that deletes or duplicates depending on whether the pointer moved a
  pixel is a trap.

  The **spread ring** is a dashed circle around the active point with a knob on it. `weight` is a
  relative multiplier with no length to it, so the ring is measured in *screen* pixels and is affine
  in the weight (`spreadRadius`/`spreadWeight`) — never smaller than 14 px, so it always clears the
  chip underneath and can be grabbed at any setting.

  A press that *picks* a shape only picks it — selecting artwork must never paint on it — so the
  click after the selecting one is the first that adds a point.

  `canvas/freeformHandles.ts` builds all that geometry once for the painter, the hit test and the
  drag, exactly as `gradientHandles.ts` does for the ramp — and reuses its `spaceMatrix`. The canvas
  bar (`canvas/GradientBar.tsx`) carries the selected point's colour and a **Freeform** button
  beside the ramp kinds.

`useGradientTool.stopId` names the active sub-object of whichever paint is being edited — a ramp stop
or a colour point.

## Crossing between a ramp and a field

The kind buttons convert rather than discard, in both the popover and the canvas bar:

- `gradientToFreeform` — one colour point per stop, laid along the gradient's own axis (its
  centre→edge line for a radial or conic).
- `freeformToGradient` — a two-stop ramp between the two points furthest apart, in their colours.
  Deliberately no more than that: projecting every point onto that axis yields stops in an arbitrary
  order, piled on top of each other, describing a picture the field never showed. A ramp has nowhere
  to put a two-dimensional arrangement, so the conversion keeps the one thing it can carry honestly
  and drops the rest.

The colour popover only converts when it has to: it remembers the ramp a field was made from, so
Gradient → Freeform → Gradient returns the original ramp rather than the lossy reduction of what it
became. The canvas bar has no such memory and always converts.
