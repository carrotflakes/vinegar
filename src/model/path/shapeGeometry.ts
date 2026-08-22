// ===========================================================================
// Canonical shape geometry — the single derivation of "what outline is this
// shape, really".
//
// Rendering, hit-testing, bucket fill, boolean ops, stroke outlining and SVG
// export all have to agree about a shape's silhouette. Before this module each
// of them re-derived it with its own `switch (shape.type)`, which is how an
// ellipse ended up being a 64-gon in one reader and an exact conic in another.
// Everything derived — modifier stacks, brush envelopes, compound components —
// resolves here once.
//
// Readers may still keep a *fast path* of their own, but only for reasons that
// are not about geometry: canvas primitives (`ctx.rect`), SVG output form
// (`<ellipse>`), or an exact analytic containment test. Those are marked at
// their call sites; anything else belongs here.
// ===========================================================================

import { cachedBrushEnvelope } from "@/model/brush/brushOutline";
import { compoundChildren } from "./compoundPath";
import { flattenSubpath, ringsToSubpaths, transformSubpath } from "./path";
import { isModifiable, resolvedSubpaths } from "./pathModifiers";
import { textSubpaths } from "../text/glyphOutlines";
import type { Document, PathSubpath, Shape, Vec2 } from "../types";

export type FillRule = "nonzero" | "evenodd";

/** Winding rule used by the shared Canvas, SVG, and hit-test geometry. */
export function shapeFillRule(shape: Shape): FillRule {
  if (shape.type === "compoundPath") return "evenodd";
  if (shape.type === "path") return shape.fillRule ?? "nonzero";
  return "nonzero";
}

// A brush envelope is already cached and immutable, so the subpath wrapper can
// be cached against the ring itself rather than recomputed per reader.
const brushSubpathCache = new WeakMap<Vec2[], PathSubpath[]>();

function brushSubpaths(ring: Vec2[]): PathSubpath[] {
  if (ring.length < 2) return [];
  const cached = brushSubpathCache.get(ring);
  if (cached) return cached;
  const subpaths = ringsToSubpaths([ring]);
  brushSubpathCache.set(ring, subpaths);
  return subpaths;
}

/**
 * A shape's outline as subpaths in its **own local space** (its `transform` is
 * not applied), with modifier stacks evaluated and brush envelopes resolved.
 * A compound path returns its components' geometry with each component's own
 * transform baked in, since those live in the compound's space.
 *
 * `null` means the shape has no vector outline at all: an image, or text whose
 * font cannot be outlined. Those are bounds-shaped content and each reader
 * decides what a box means for them.
 */
export function shapeSubpaths(
  shape: Shape,
  doc?: Document
): PathSubpath[] | null {
  if (isModifiable(shape)) return resolvedSubpaths(shape);
  switch (shape.type) {
    case "brush":
      return brushSubpaths(cachedBrushEnvelope(shape));
    case "compoundPath":
      return (doc ? compoundChildren(doc, shape) : []).flatMap((component) =>
        (shapeSubpaths(component, doc) ?? []).map((subpath) =>
          transformSubpath(component.transform, subpath)
        )
      );
    case "text":
      // Null whenever the painted glyphs cannot be reproduced as outlines
      // (system font, font still loading) — see `textSubpaths`.
      return textSubpaths(shape);
    case "image":
      return null;
  }
}

export interface Polyline {
  points: Vec2[];
  closed: boolean;
}

/**
 * `shapeSubpaths` flattened to polylines. Closed contours carry unique
 * vertices — the start point is not repeated at the end — so consumers that
 * close the ring themselves (polygon containment, Clipper) do not see a
 * degenerate final edge.
 */
export function shapePolylines(
  shape: Shape,
  doc?: Document,
  perSegment = 18
): Polyline[] {
  return (shapeSubpaths(shape, doc) ?? []).map((subpath) => {
    const points = flattenSubpath(subpath, perSegment);
    return {
      points: subpath.closed && points.length > 1 ? points.slice(0, -1) : points,
      closed: subpath.closed,
    };
  });
}

/** Closed contours only, as rings — the input every area operation wants. */
export function shapeRings(shape: Shape, doc?: Document): Vec2[][] {
  return shapePolylines(shape, doc)
    .filter((line) => line.points.length >= 3)
    .map((line) => line.points);
}

/**
 * Whether the shape's geometry is closed everywhere. Inside/outside — and so
 * stroke alignment, or washing a highlight over the interior — is only
 * meaningful when it is. Text is closed by way of its glyph outlines; an image
 * has no outline to align a stroke to.
 */
export function isClosedGeometry(shape: Shape): boolean {
  if (shape.type === "text") return true;
  // Compound components are closed by construction (`isCompoundChild`), so the
  // answer never needs the document to resolve them.
  if (shape.type === "compoundPath") return true;
  const subpaths = shapeSubpaths(shape);
  if (!subpaths) return false;
  return subpaths.length > 0 && subpaths.every((subpath) => subpath.closed);
}
