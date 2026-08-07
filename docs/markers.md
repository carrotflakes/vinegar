# End markers

Status: **implemented** (2026-08-08). File version: **v35** (additive fields on
`line` / `path`; absent still means no marker, but Vinegar's current-version-only
file policy requires the bump). Related:
[document-model.md](document-model.md), [path-modifiers.md](path-modifiers.md).

## Problem / motivation

Diagram and annotation work needs a "look here" line. Without markers the only
way to get an arrow was to place an Arrow *generator* shape next to a line —
two unrelated nodes that drift apart the moment either is moved. Markers make
the arrowhead part of the line's appearance instead.

## Decision (data model)

```ts
interface MarkableShapeBase extends ModifiableShapeBase {
  markerStart?: Marker;   // absent ⇒ that end carries no marker
  markerEnd?: Marker;
}
// line and path extend it — a rect or an ellipse has no ends to mark.

interface Marker {
  shape: "arrow" | "triangle" | "circle" | "square" | "diamond" | "bar";
  scale: number;    // size as a multiple of the stroke width
  filled: boolean;  // solid vs hollow; ignored by arrow and bar
  flip: boolean;    // point back along the path instead of outward
}
```

Six shapes and two orthogonal flags rather than a long enum: `filled` alone
turns triangle/circle/square/diamond into eight marks (hollow ones are the UML
and technical-drawing vocabulary), and `flip` covers inward-pointing dimension
arrows without a "reverse triangle" entry.

The same two fields live on the **new-shape defaults** (`state.style`), so a
line or path can be drawn with its arrow already on. `markersFromDefaults` is
kept out of `styleFromDefaults` so a rect or a text node never grows a field its
type does not have.

**Sizes are relative to the stroke width**, matching SVG's
`markerUnits="strokeWidth"`, so a marked line stays proportioned when its weight
changes. `scale` then scales the mark alone. The marker's *own* line weight —
the open `arrow`'s V, a `bar`'s tick, a hollow shape's outline — is always the
shape's `strokeWidth` unscaled: the marker is drawn with the same pen as the
line it terminates.

## Geometry and placement

`model/marker.ts` is the single source of truth. `markerContours(shape)` returns
each marker as a `PathSubpath` **already placed in the shape's local space**,
plus whether it is filled; `strokeEndContours(shape)` wraps it with the
replacement caps described below. Everything else — canvas painting, SVG export
— consumes that one function, which is what keeps the two in agreement.

- Markers sit on **resolved** geometry, so they follow the modifier stack
  (`reverse` swaps which end is the end; `offset` moves both).
- **Only open ends** carry them. Every open subpath of a multi-subpath path is
  marked at both of its ends; a closed contour gets nothing. The two fields say
  how the shape's strokes *terminate*, so a path holding several open contours
  terminates all of them the same way. This differs from SVG's `marker-start`
  (first vertex of the whole path only) and is one reason export bakes explicit
  geometry rather than emitting `<marker>` defs. It also means an operation that
  multiplies open contours multiplies the marks: cutting a marked line in two
  yields two arrows and two tails, and `splitSubpaths` copies both markers onto
  every piece.
- Pointed marks (`arrow`, `triangle`) attach their **tip** at the end point and
  trail backwards, so an arrow never overshoots the line's end. Symmetric ones
  (`circle`, `square`, `diamond`, `bar`) sit **centred** on it.
- Orientation follows the outward tangent at the end; `flip` adds a half turn.

## Painting

Markers are **drawn over the stroke, not merged into it** — the same thing SVG
`<marker>`, Illustrator and Figma do. Unioning would require outlining the
stroke first, which is expensive, self-intersects, and would have to re-run on
every width or colour change.

- They are painted with the shape's `stroke` paint: filled contours are filled
  with it, open and hollow ones traced with it.
- The **dash pattern is cleared** for markers: a dash belongs to the line, never
  to the mark on its end.
- **A marked end has no line cap.** The marker terminates the stroke, so the pen
  is switched to a butt cap and the caps of the ends *without* a marker are
  drawn back as contours (`strokeEndContours`). Otherwise a round cap pokes out
  past an arrowhead's tip. A **dash pattern opts out** of this: there the cap
  shapes every dash, not just the two ends (the dotted preset is literally
  zero-length dashes with round caps), so a dashed marked line keeps its caps
  and can show that overhang.
- Marker corners are **always round-joined**, whatever the shape's own join is:
  the corners belong to the marker's artwork, and a miter would spike an open
  arrow's vertex past the very end point it is placed on (and past the reach
  `markerOutset` reserves for it).
- Stroke **alignment does not apply** — a marker is its own contour, not an
  offset of the shape's silhouette.
- Geometry is baked in the shape's coordinate space rather than placed with a
  transform, so a user-space gradient runs continuously from the line into its
  arrowhead in both canvas and SVG.

**Known cosmetic limits**, both from overlaying rather than trimming:

- A *translucent* stroke reads slightly darker where the marker overlaps it.
  Opaque strokes — the overwhelming majority — show nothing.
- A *hollow* marker shows the line stub inside it (the line runs to the mark's
  centre and the ring is only drawn over it). UML-style notation would have the
  line stop at the mark's boundary.

Both are fixed by the same deferred change: trimming the stroke back by the
length the marker covers. That needs a per-shape "how far do I cover the line"
number beside each contour and a stroke path distinct from the fill path in both
the canvas and the SVG paths, so it waits for a real case.

## Bounds, hit-testing, export

- `strokeOutset()` (and the culling margin in `canvas/render/bounds.ts`)
  includes the marker reach, so markers are never clipped by layer sizing,
  culling, or the export crop.
- `shapeBounds` stays pure geometry, as it does for strokes: the selection frame
  hugs the path, and the arrowhead may extend past it.
- Markers are **not hit-testable** — clicking one selects nothing on its own.
  The shape's own geometry is the target. Good enough while the mark sits at the
  end of a line the user can already click.
- SVG export emits each marker as a sibling `<path>` inside a `<g>` that carries
  the node's opacity / blend / transform / filter. SVG **import** does not read
  `marker-start` / `marker-end`; an imported arrow stays plain geometry.

## Not in this version

- Arbitrary nodes or symbols as markers. The enum can widen to
  `{ kind: "builtin" } | { kind: "symbol", id }` later; doing it now would drag
  in cycle checks, definition carry-over and `<marker>` def generation.
- Mid-path markers (`marker-mid`), independent marker colour, per-end size
  presets, decorative arrowhead families.
- "Outline markers to paths" — that is the same work as a future outline
  modifier and should land there, not here.
