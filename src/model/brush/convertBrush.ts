// Centerline conversions between paths and brush strokes. Unlike
// `convertShapeToPath` (which turns a brush into the filled outline of its
// variable-width envelope), these treat the brush *centerline* and a path
// contour as the same cubic Bézier, so path↔brush round-trips its geometry.
// The width profile is deliberately not preserved: path→brush gives every
// anchor `w: 1`, and brush→path drops `w` entirely.

import { cachedBrushEnvelope } from "@/model/brush/brushOutline";
import { IDENTITY } from "@/model/geometry/matrix";
import { strokeDetailFields } from "../stroke";
import { resolvedSubpaths } from "@/model/path/pathModifiers";
import {
  baseNodeDefaults,
  makeId,
  type BrushAnchor,
  type BrushShape,
  type Group,
  type PathAnchor,
  type PathShape,
  type PathSubpath,
  type SceneNode,
} from "../types";

/** Base width for a brush made from a path with no usable stroke width;
 * matches `BRUSH_DEFAULTS.size` in the brush tool. */
const DEFAULT_BRUSH_WIDTH = 8;

/** A subpath contributes a brush only if it has a drawable centerline. */
function hasBrushableCenterline(subpath: PathSubpath): boolean {
  return subpath.anchors.length >= 2;
}

/**
 * A path with at least one contour of two or more anchors, i.e. something whose
 * centerline can become a brush stroke.
 */
export function canConvertPathToBrush(
  node: SceneNode | undefined
): node is PathShape {
  return (
    node?.type === "path" && resolvedSubpaths(node).some(hasBrushableCenterline)
  );
}

function brushAnchorFromPath(anchor: PathAnchor): BrushAnchor {
  return {
    p: { ...anchor.p },
    hIn: anchor.hIn ? { ...anchor.hIn } : null,
    hOut: anchor.hOut ? { ...anchor.hOut } : null,
    ...(anchor.t !== undefined ? { t: anchor.t } : {}),
    // Width is not carried across; every anchor gets the full base width.
    w: 1,
  };
}

/** The base-width and paint fields a brush inherits from its source path. */
function brushAppearance(shape: PathShape): Pick<
  BrushShape,
  "stroke" | "strokeWidth" | "fill"
> {
  return {
    // Painted with the stroke paint; fall back to the fill so a fill-only path
    // does not become an invisible (no-paint) brush.
    stroke: shape.stroke ?? shape.fill,
    strokeWidth: shape.strokeWidth > 0 ? shape.strokeWidth : DEFAULT_BRUSH_WIDTH,
    fill: null,
  };
}

export interface ConvertPathToBrushResult {
  /** One brush per drawable contour, back-to-front. */
  brushes: BrushShape[];
  /**
   * Wraps the brushes when the path had several contours, taking the source's
   * slot and carrying its composite state. `null` for a single contour, whose
   * brush replaces the source in place.
   */
  group: Group | null;
}

/**
 * Turn each open-able contour of a path into a brush stroke. Closed contours
 * become open centerlines (a brush is always an open line). Every anchor gets
 * `w: 1`, so the stroke has uniform width; the path's `strokeWidth` (or a
 * default when it has none) becomes the base width.
 *
 * A single-contour path yields one brush that replaces it in place, keeping its
 * id, name, transform and composite state. A multi-contour path yields one
 * neutral brush per contour wrapped in a group that carries that state, exactly
 * as `splitSubpaths` does, so the result composites like the source.
 *
 * Returns null when no contour has a drawable centerline.
 */
export function convertPathToBrush(
  shape: PathShape
): ConvertPathToBrushResult | null {
  const subpaths = resolvedSubpaths(shape).filter(hasBrushableCenterline);
  if (!subpaths.length) return null;
  const appearance = brushAppearance(shape);
  const detail = strokeDetailFields(shape);

  if (subpaths.length === 1) {
    const brush: BrushShape = {
      id: shape.id,
      name: shape.name,
      type: "brush",
      anchors: subpaths[0].anchors.map(brushAnchorFromPath),
      ...appearance,
      ...detail,
      opacity: shape.opacity,
      blendMode: shape.blendMode,
      effects: structuredClone(shape.effects),
      hidden: shape.hidden,
      locked: shape.locked,
      // The brush geometry no longer matches the generator's path output.
      generator: null,
      bindings: { ...shape.bindings },
      transform: [...shape.transform],
      transformOrigin: shape.transformOrigin
        ? { ...shape.transformOrigin }
        : null,
    };
    return { brushes: [brush], group: null };
  }

  const brushes: BrushShape[] = subpaths.map((sp, i) => ({
    id: makeId("brush"),
    name: `${shape.name} ${i + 1}`,
    type: "brush",
    anchors: sp.anchors.map(brushAnchorFromPath),
    ...appearance,
    ...detail,
    ...baseNodeDefaults(),
    transform: [...IDENTITY] as BrushShape["transform"],
  }));
  const group: Group = {
    id: makeId("group"),
    name: shape.name,
    type: "group",
    clipsToMask: false,
    bindings: {},
    childIds: brushes.map((brush) => brush.id),
    transform: [...shape.transform],
    transformOrigin: shape.transformOrigin,
    opacity: shape.opacity,
    blendMode: shape.blendMode,
    effects: structuredClone(shape.effects),
    hidden: shape.hidden,
    locked: shape.locked,
    generator: null,
  };
  return { brushes, group };
}

/**
 * A brush that can become a filled outline path. A single anchor still has a
 * drawable envelope (a round-cap disk), so any non-empty brush qualifies; the
 * conversion itself guards the rare degenerate ring.
 */
export function canConvertBrushToOutline(
  node: SceneNode | undefined
): node is BrushShape {
  return node?.type === "brush" && node.anchors.length >= 1;
}

/**
 * Convert a brush to the filled outline of its variable-width envelope, keeping
 * the appearance: the ring is filled with the brush's `stroke` paint under the
 * nonzero winding rule (fill and stroke width become inert). This is the
 * appearance-preserving direction; `convertBrushToCenterlinePath` is the
 * geometry-faithful one. Returns null when the envelope is degenerate.
 */
export function convertBrushToOutlinePath(shape: BrushShape): PathShape | null {
  const ring = cachedBrushEnvelope(shape);
  if (ring.length < 3) return null;
  return {
    id: shape.id,
    name: shape.name,
    type: "path",
    subpaths: [
      {
        closed: true,
        anchors: ring.map((p) => ({ p: { ...p }, hIn: null, hOut: null })),
      },
    ],
    fillRule: "nonzero",
    // The envelope is filled with the brush's paint; the stroke goes inert.
    fill: shape.stroke,
    stroke: null,
    strokeWidth: 0,
    ...strokeDetailFields(shape),
    opacity: shape.opacity,
    blendMode: shape.blendMode,
    effects: structuredClone(shape.effects),
    hidden: shape.hidden,
    locked: shape.locked,
    // The envelope outline no longer matches the generator's brush output.
    generator: null,
    bindings: {},
    transform: [...shape.transform],
    transformOrigin: shape.transformOrigin
      ? { ...shape.transformOrigin }
      : null,
  };
}

function pathAnchorFromBrush(anchor: BrushAnchor): PathAnchor {
  return {
    p: { ...anchor.p },
    hIn: anchor.hIn ? { ...anchor.hIn } : null,
    hOut: anchor.hOut ? { ...anchor.hOut } : null,
    ...(anchor.t !== undefined ? { t: anchor.t } : {}),
  };
}

/**
 * Convert a brush centerline to an open, stroked path in place: the brush's
 * `stroke` paint and base `strokeWidth` become the path's stroke, and each
 * anchor's `w` width multiplier is dropped, so the variable-width envelope
 * flattens to a uniform-width stroke. This backs the brush case of
 * `convertShapeToPath` (the geometry-faithful direction);
 * `convertBrushToOutlinePath` is the appearance-preserving envelope direction.
 */
export function convertBrushToCenterlinePath(shape: BrushShape): PathShape {
  return {
    id: shape.id,
    name: shape.name,
    type: "path",
    subpaths: [
      { closed: false, anchors: shape.anchors.map(pathAnchorFromBrush) },
    ],
    fillRule: "nonzero",
    fill: null,
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    ...strokeDetailFields(shape),
    opacity: shape.opacity,
    blendMode: shape.blendMode,
    effects: structuredClone(shape.effects),
    hidden: shape.hidden,
    locked: shape.locked,
    generator: null,
    bindings: { ...shape.bindings },
    transform: [...shape.transform],
    transformOrigin: shape.transformOrigin
      ? { ...shape.transformOrigin }
      : null,
  };
}
