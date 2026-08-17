import {
  expandBounds,
  frameLocalBounds,
  intersectBounds,
  shapeBounds,
  worldShapeBounds,
} from "@/model/geometry/bounds";
import { matrixScale, nodeWorldMatrix, transformBounds } from "@/model/geometry/matrix";
import { screenToWorld, type Viewport } from "@/model/geometry/viewport";
import { compoundChildren } from "@/model/path/compoundPath";
import { effectsMargin } from "@/model/effects";
import { markerOutset } from "@/model/marker";
import { isShape } from "@/model/scene";
import { containerContents } from "@/model/sceneWalk";
import { effectiveStrokeAlignment, STROKE_MITER_LIMIT } from "@/model/stroke";
import type { Bounds, Document, Matrix, Shape } from "@/model/types";
import { renderCachesDisabled } from "@/debug/renderFlags";

export interface PaintTraversal {
  visibleWorldBounds: Bounds;
  visualBounds: Map<string, Bounds | null>;
  layerBounds: Map<string, Bounds | null>;
  cullExemptIds: Set<string>;
  stats: { paintedNodes: number; culledNodes: number };
  /** Definition children are painted under an instance transform, while their
   * indexed bounds are symbol-local. The instance itself is still culled. */
  cullingDisabled?: boolean;
}

function unionBounds(bounds: Array<Bounds | null>): Bounds | null {
  const list = bounds.filter((value): value is Bounds => value !== null);
  if (!list.length) return null;
  const x = Math.min(...list.map((value) => value.x));
  const y = Math.min(...list.map((value) => value.y));
  const right = Math.max(...list.map((value) => value.x + value.width));
  const bottom = Math.max(...list.map((value) => value.y + value.height));
  return { x, y, width: right - x, height: bottom - y };
}

function shapeStrokeMargin(shape: Shape): number {
  if (shape.type === "brush" || !shape.stroke || shape.strokeWidth <= 0) {
    return 0;
  }
  const alignment = effectiveStrokeAlignment(shape);
  const pen = alignment === "outside"
    ? shape.strokeWidth * STROKE_MITER_LIMIT
    : alignment === "center"
      ? (shape.strokeWidth * STROKE_MITER_LIMIT) / 2
      : 0;
  return Math.max(pen, markerOutset(shape));
}

function shapePaintBounds(
  shape: Shape,
  doc: Document,
  cacheable: boolean
): Bounds {
  return expandBounds(
    cacheable ? cachedCullingShapeBounds(shape, doc) : shapeBounds(shape, doc),
    shapeStrokeMargin(shape)
  );
}

/**
 * Effects are applied isotropically in *device* space, so an effect margin
 * measured in a node's local space has to survive the most compressed
 * direction of that node's transform. The factor is 1 for uniform scale and
 * rotation; under `scale(9, 1)` the blur radius grows by `sqrt(|det|)` = 3
 * while the local margin's y extent is only scaled by 1, so the margin has to
 * be tripled for the halo to still fit.
 */
function localEffectScale(transform: Matrix): number {
  const det = Math.abs(
    transform[0] * transform[3] - transform[1] * transform[2]
  );
  return det > 1e-12 ? matrixScale(transform) / Math.sqrt(det) : 1;
}

/** A child's contribution to its parent's local bounds: the child's content,
 *  widened by the child's own effect halo, then placed by its transform. */
function childLocalVisualBounds(
  doc: Document,
  childId: string,
  preview: Shape | null | undefined,
  cache: Map<string, Bounds | null> | undefined,
  visiting: Set<string>
): Bounds | null {
  const child = doc.nodes[childId];
  const content = nodeLocalContentBounds(doc, childId, preview, cache, visiting);
  if (!child || !content) return null;
  return transformBounds(
    expandBounds(
      content,
      effectsMargin(child.effects) * localEffectScale(child.transform)
    ),
    child.transform
  );
}

/**
 * Conservative bounds of a node's *content* in its own coordinate system,
 * excluding the node's own effect halo — callers add that in device space,
 * where the effect radius is exact. Unlike the world-space culling index these
 * bounds also work while rendering a symbol definition under an instance
 * transform. They only size temporary layers, so a safe over-estimate is
 * preferable to clipped pixels.
 */
export function nodeLocalContentBounds(
  doc: Document,
  nodeId: string,
  preview?: Shape | null,
  cache?: Map<string, Bounds | null>,
  visiting: Set<string> = new Set()
): Bounds | null {
  if (cache?.has(nodeId)) return cache.get(nodeId) ?? null;
  if (visiting.has(nodeId)) return null;
  const stored = doc.nodes[nodeId];
  if (!stored || stored.hidden) {
    cache?.set(nodeId, null);
    return null;
  }
  visiting.add(nodeId);

  let bounds: Bounds | null = null;
  if (isShape(stored)) {
    const shape = preview?.id === stored.id ? preview : stored;
    bounds = shapePaintBounds(shape, doc, shape === stored);
  } else {
    const contents = containerContents(doc, stored);
    // Lazy: a clipping frame never looks at what it would have cropped away.
    const children = () =>
      unionBounds(
        (contents?.childIds ?? []).map((id) =>
          childLocalVisualBounds(doc, id, preview, cache, visiting)
        )
      );
    if (!contents) {
      bounds = null;
    } else if (contents.kind === "frame") {
      // A clipping frame is its own box; an open one also spans what overflows.
      const frameBounds = frameLocalBounds(contents.frame);
      bounds = contents.frame.clipsContent
        ? frameBounds
        : unionBounds([frameBounds, children()]);
    } else if (contents.kind === "group") {
      bounds = children();
      const { mask } = contents;
      if (bounds && mask) {
        const geometry = preview?.id === mask.id ? preview : mask;
        bounds = intersectBounds(
          bounds,
          transformBounds(
            geometry === mask
              ? cachedCullingShapeBounds(geometry, doc)
              : shapeBounds(geometry, doc),
            geometry.transform
          )
        );
      }
    } else {
      // An instance is its definition's content in the instance's own space.
      bounds = children();
    }
  }

  visiting.delete(nodeId);
  cache?.set(nodeId, bounds);
  return bounds;
}

const cullingShapeBoundsCache = new WeakMap<
  Shape,
  { bounds: Bounds; components?: Shape[] }
>();

/** Bounds caching is deliberately scoped to persisted document shapes.
 * Transient pen/pencil previews are mutable and must never enter this cache. */
function cachedCullingShapeBounds(shape: Shape, doc: Document): Bounds {
  if (renderCachesDisabled) return shapeBounds(shape, doc);
  const cached = cullingShapeBoundsCache.get(shape);
  if (shape.type !== "compoundPath") {
    if (cached) return cached.bounds;
    const bounds = shapeBounds(shape, doc);
    cullingShapeBoundsCache.set(shape, { bounds });
    return bounds;
  }
  const components = compoundChildren(doc, shape);
  if (
    cached?.components &&
    cached.components.length === components.length &&
    cached.components.every(
      (component, index) => component === components[index]
    )
  ) {
    return cached.bounds;
  }
  const bounds = shapeBounds(shape, doc);
  cullingShapeBoundsCache.set(shape, { bounds, components });
  return bounds;
}

/** Conservative painted bounds, including stroke and effects, for culling. */
export function visualNodeWorldBounds(
  doc: Document,
  nodeId: string,
  cache: Map<string, Bounds | null>,
  visiting: Set<string> = new Set()
): Bounds | null {
  if (cache.has(nodeId)) return cache.get(nodeId) ?? null;
  if (visiting.has(nodeId)) return null;
  const node = doc.nodes[nodeId];
  if (!node || node.hidden) {
    cache.set(nodeId, null);
    return null;
  }
  visiting.add(nodeId);

  let bounds: Bounds | null;
  if (isShape(node)) {
    let local = expandBounds(
      cachedCullingShapeBounds(node, doc),
      shapeStrokeMargin(node)
    );
    local = expandBounds(local, effectsMargin(node.effects));
    bounds = transformBounds(local, nodeWorldMatrix(doc, node.id));
  } else {
    const contents = containerContents(doc, node);
    // Lazy: a clipping frame never looks at what it would have cropped away,
    // and this is the culling hot path.
    const children = () =>
      unionBounds(
        (contents?.childIds ?? []).map((id) =>
          visualNodeWorldBounds(doc, id, cache, visiting)
        )
      );
    if (!contents) {
      bounds = null;
    } else if (contents.kind === "frame") {
      // A clipping frame is its own box; an open one also spans what overflows.
      const frameBounds = transformBounds(
        frameLocalBounds(contents.frame),
        nodeWorldMatrix(doc, node.id)
      );
      bounds = contents.frame.clipsContent
        ? frameBounds
        : unionBounds([frameBounds, children()]) ?? frameBounds;
    } else if (contents.kind === "instance") {
      // A definition root is not parented to the instance, so its own matrix
      // chain only reaches symbol space; the instance matrix maps it to world.
      const content = children();
      bounds = content
        ? transformBounds(content, nodeWorldMatrix(doc, node.id))
        : null;
    } else if (contents.mask) {
      const content = children();
      bounds = content
        ? intersectBounds(content, worldShapeBounds(doc, contents.mask))
        : content;
    } else {
      bounds = children();
    }
    if (bounds) {
      bounds = expandBounds(
        bounds,
        effectsMargin(node.effects) * matrixScale(nodeWorldMatrix(doc, node.id))
      );
    }
  }

  visiting.delete(nodeId);
  cache.set(nodeId, bounds);
  return bounds;
}

export function visibleWorldBounds(
  viewport: Viewport,
  width: number,
  height: number
): Bounds {
  const corners = [
    screenToWorld(viewport, { x: 0, y: 0 }),
    screenToWorld(viewport, { x: width, y: 0 }),
    screenToWorld(viewport, { x: width, y: height }),
    screenToWorld(viewport, { x: 0, y: height }),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}
