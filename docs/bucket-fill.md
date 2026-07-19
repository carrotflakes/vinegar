# Bucket fill — design

Status: v1 shipped. The Bucket Fill tool (`G`) fills the enclosed empty region
under a click with the current fill color, as a plain vector polygon inserted
*below* the surrounding ink.

## Decisions up front

- **Vector region detection, not raster flood fill.** The region is computed
  with Clipper from the actual document geometry, so the result is
  resolution-independent and exports/scales cleanly. The raster route
  (rasterize → flood fill → trace) was rejected: it ties the boundary quality
  to a sampling resolution and produces noisy traced polygons.
- **"Union holes", not a planar arrangement.** A full Live-Paint-style planar
  map (split every face along every intersection) is heavy and numerically
  fragile. Instead, all visible ink is unioned into one polygon set; every
  enclosed empty region is then simply a *hole* of that union, and the click
  picks the hole containing the point. This finds exactly the regions a
  flood fill would, at a fraction of the complexity.
- **The fill is a snapshot.** It does not track later edits of the bounding
  strokes (no live re-flow). It is an ordinary `polygon` node: selectable,
  paintable, undoable, exportable with zero new machinery.
- **Inserted at the back of the active drawing container** (the drilled-into
  group, else the scope root), so line art keeps painting over its fills —
  the coloring-book stacking every paint app uses.
- **Clicking on a fill is not an error — it's a "cover".** A fill-painted
  shape (or image) under the click stops being an obstacle; instead its
  outline becomes the region's outer boundary, and the new fill is inserted
  *directly above it*. This is the raster-bucket semantic of "the color you
  clicked spreads to its edges": paint a background, draw line art on top,
  and fills clicked over the background land between the two. Only fills and
  images soften this way — strokes, brush envelopes and text stay hard ink,
  and clicking them still reports "nothing to fill".

## Algorithm (model/bucketFill.ts)

1. **Collect ink.** Walk the visible nodes of the current editing scope. Every
   shape contributes its painted silhouette in scope-view space: fill
   geometry (implicitly closing open paths, like rendering), stroke bands via
   `strokeOutline`, brush envelopes, image rectangles, and text line boxes
   (coarse stand-in for glyph outlines). Clip groups contribute their content
   *intersected with the mask silhouette*; instances recurse into their
   symbol definition. Each source is normalized by a per-source Clipper union
   under its own fill rule, so self-intersections, even-odd shapes and
   mirroring transforms all reduce to canonically oriented contours.
2. **Classify covers.** While collecting, a shape whose *fill* silhouette
   contains the click point is set aside as a cover instead of an obstacle
   (its stroke still counts as ink). The topmost cover wins; covers below it
   are invisible at the point and are dropped entirely. Cover detection is
   disabled inside clip groups and instances, whose composite ink cannot be
   partially excluded.
3. **Inflate + union.** All obstacle contours are offset outward by half the
   gap tolerance (`ClipperOffset`, round joins) — gaps narrower than the
   tolerance seal shut — and unioned into one poly tree.
4. **Pick the region.**
   - *No cover:* descend the tree at the click point. Ink islands alternate
     with holes; landing in a hole (but outside its nested islands)
     identifies the region, and the nested islands' outer contours become the
     region's holes. Landing on ink or outside everything reports a friendly
     toast instead.
   - *Cover:* the region is the connected component of
     `cover silhouette − inflated ink` containing the point, so it is bounded
     by strokes where they exist and by the cover's own edge where they
     don't. A bare cover click fills the whole shape.
5. **Re-expand.** The region is the true region eroded by the inflation, so
   it is offset back out by `inflation + bleed` (bleed = 0.5 world units).
   The fill therefore tucks under the surrounding ink, hiding antialiasing
   seams along shared edges. Because erode-then-dilate is a morphological
   opening, the fill can poke at most `bleed` past the true region (a small
   nub inside a bridged gap). With a cover, the expansion is clipped back to
   the cover silhouette — past its edge the fill would show over whatever is
   underneath, so that boundary is met exactly, never crossed.

The result lands via `addFillShape`, which bakes the inverse of the container's
world matrix into the node's transform so scope-view coordinates parent
correctly anywhere. With a cover it is inserted as the cover's next sibling
(directly above it); otherwise at the back of the active drawing container.

## Options

- **Gap closing** (Bucket panel, persisted in `bucketStore`): widest boundary
  gap in world units that still counts as closed. Default 4.

## Known limitations / follow-ups

- Output is a flattened polygon; no curve re-fitting of the region boundary.
- No hover preview of the region (would need an obstacle-union cache keyed on
  the document revision; the same cache would speed up rapid repeated fills).
- Text bounds as ink are the line box, not glyph outlines.
- Artboard edges do not bound a region; an open sketch on a board cannot be
  filled to the board edge.
- Region detection is z-order-blind below the cover: ink completely hidden
  *under* the cover (or under other ink) still blocks/carves the region even
  though it is invisible.
- Ink-to-cover-edge gaps only close up to *half* the gap tolerance (the cover
  edge does not inflate; only the ink side does).
- Clicking a stroke/brush does not recolor it (Live-Paint-style edge re-fill).
