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
import { resolvedSubpaths } from "@/model/path/pathModifiers";
import { clippingContentIds, clippingMask } from "@/model/clippingMask";
import { effectsMargin } from "@/model/effects";
import { isFrame, isGroup, isInstance, isShape } from "@/model/scene";
import { scopedNode } from "@/model/params";
import { instanceScope, type VarScope } from "@/model/vars";
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

function shapeStrokeMargin(shape: Shape, doc: Document): number {
  if (shape.type === "brush" || !shape.stroke || shape.strokeWidth <= 0) {
    return 0;
  }
  const alignment = effectiveStrokeAlignment(shape, doc);
  return alignment === "outside"
    ? shape.strokeWidth * STROKE_MITER_LIMIT
    : alignment === "center"
      ? (shape.strokeWidth * STROKE_MITER_LIMIT) / 2
      : 0;
}

function shapePaintBounds(
  shape: Shape,
  doc: Document,
  cacheable: boolean
): Bounds {
  return expandBounds(
    cacheable ? cachedCullingShapeBounds(shape, doc) : shapeBounds(shape, doc),
    shapeStrokeMargin(shape, doc)
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

/**
 * Bounds caches are keyed by node id, but a definition's content measures
 * differently under each instance that overrides a numeric parameter, so the
 * scope's numeric identity joins the key. It is empty everywhere phase 2b is
 * not in play, which leaves the key — and the hit rate — exactly as before.
 */
const boundsKey = (scope: VarScope | undefined, nodeId: string): string =>
  scope?.numberKey ? `${scope.numberKey} ${nodeId}` : nodeId;

/** A child's contribution to its parent's local bounds: the child's content,
 *  widened by the child's own effect halo, then placed by its transform. */
function childLocalVisualBounds(
  doc: Document,
  childId: string,
  preview: Shape | null | undefined,
  cache: Map<string, Bounds | null> | undefined,
  visiting: Set<string>,
  scope?: VarScope
): Bounds | null {
  const child = doc.nodes[childId];
  const content = nodeLocalContentBounds(doc, childId, preview, cache, visiting, scope);
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
  visiting: Set<string> = new Set(),
  scope?: VarScope
): Bounds | null {
  const key = boundsKey(scope, nodeId);
  if (cache?.has(key)) return cache.get(key) ?? null;
  if (visiting.has(nodeId)) return null;
  const stored = doc.nodes[nodeId];
  if (!stored || stored.hidden) {
    cache?.set(key, null);
    return null;
  }
  visiting.add(nodeId);

  let bounds: Bounds | null = null;
  if (isShape(stored)) {
    const shape = preview?.id === stored.id ? preview : scopedNode(stored, scope);
    bounds = shapePaintBounds(shape, doc, shape !== preview);
  } else if (isFrame(stored)) {
    const frameBounds = frameLocalBounds(stored);
    bounds = stored.clipsContent
      ? frameBounds
      : unionBounds([
          frameBounds,
          ...stored.childIds.map((id) =>
            childLocalVisualBounds(doc, id, preview, cache, visiting, scope)
          ),
        ]);
  } else if (isGroup(stored)) {
    bounds = unionBounds(
      clippingContentIds(doc, stored).map((id) =>
        childLocalVisualBounds(doc, id, preview, cache, visiting, scope)
      )
    );
    const mask = clippingMask(doc, stored);
    if (bounds && mask) {
      const geometry =
        preview?.id === mask.id ? preview : scopedNode(mask, scope);
      bounds = intersectBounds(
        bounds,
        transformBounds(
          geometry === preview
            ? shapeBounds(geometry, doc)
            : cachedCullingShapeBounds(geometry, doc),
          geometry.transform
        )
      );
    }
  } else if (isInstance(stored)) {
    const definition = doc.symbols[stored.symbolId];
    if (definition) {
      bounds = childLocalVisualBounds(
        doc,
        definition.rootNodeId,
        preview,
        cache,
        visiting,
        instanceScope(doc, stored, scope)
      );
    }
  }

  visiting.delete(nodeId);
  cache?.set(key, bounds);
  return bounds;
}

const cullingShapeBoundsCache = new WeakMap<
  Shape,
  { bounds: Bounds; components?: Shape[]; resolved?: unknown }
>();

/** Bounds caching is deliberately scoped to persisted document shapes.
 * Transient pen/pencil previews are mutable and must never enter this cache.
 * Like the Path2D cache, an entry keyed on shape identity alone is not enough
 * where the geometry depends on another node: a compound path validates its
 * components, and a path validates its resolved subpaths, since a boolean
 * modifier's operand can move without replacing this shape. */
function cachedCullingShapeBounds(shape: Shape, doc: Document): Bounds {
  if (renderCachesDisabled) return shapeBounds(shape, doc);
  const cached = cullingShapeBoundsCache.get(shape);
  if (shape.type !== "compoundPath") {
    const resolved = shape.type === "path" ? resolvedSubpaths(shape, doc) : null;
    if (cached && cached.resolved === resolved) return cached.bounds;
    const bounds = shapeBounds(shape, doc);
    cullingShapeBoundsCache.set(shape, { bounds, resolved });
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
  visiting: Set<string> = new Set(),
  scope?: VarScope
): Bounds | null {
  const key = boundsKey(scope, nodeId);
  if (cache.has(key)) return cache.get(key) ?? null;
  if (visiting.has(nodeId)) return null;
  const stored = doc.nodes[nodeId];
  if (!stored || stored.hidden) {
    cache.set(key, null);
    return null;
  }
  const node = scopedNode(stored, scope);
  visiting.add(nodeId);

  let bounds: Bounds | null;
  if (isShape(node)) {
    let local = expandBounds(
      cachedCullingShapeBounds(node, doc),
      shapeStrokeMargin(node, doc)
    );
    local = expandBounds(local, effectsMargin(node.effects));
    bounds = transformBounds(local, nodeWorldMatrix(doc, node.id));
  } else if (isInstance(node)) {
    const definition = doc.symbols[node.symbolId];
    const content = definition
      ? visualNodeWorldBounds(
          doc,
          definition.rootNodeId,
          cache,
          visiting,
          instanceScope(doc, node, scope)
        )
      : null;
    bounds = content
      ? transformBounds(content, nodeWorldMatrix(doc, node.id))
      : null;
    if (bounds) {
      bounds = expandBounds(
        bounds,
        effectsMargin(node.effects) * matrixScale(nodeWorldMatrix(doc, node.id))
      );
    }
  } else if (isFrame(node)) {
    const frameBounds = transformBounds(
      frameLocalBounds(node),
      nodeWorldMatrix(doc, node.id)
    );
    bounds = node.clipsContent
      ? frameBounds
      : unionBounds([
          frameBounds,
          ...node.childIds.map((id) =>
            visualNodeWorldBounds(doc, id, cache, visiting, scope)
          ),
        ]) ?? frameBounds;
    bounds = expandBounds(
      bounds,
      effectsMargin(node.effects) * matrixScale(nodeWorldMatrix(doc, node.id))
    );
  } else if (isGroup(node)) {
    const children = unionBounds(
      clippingContentIds(doc, node).map((id) =>
        visualNodeWorldBounds(doc, id, cache, visiting, scope)
      )
    );
    const mask = clippingMask(doc, node);
    bounds =
      children && mask
        ? intersectBounds(children, worldShapeBounds(doc, scopedNode(mask, scope)))
        : children;
    if (bounds) {
      bounds = expandBounds(
        bounds,
        effectsMargin(node.effects) * matrixScale(nodeWorldMatrix(doc, node.id))
      );
    }
  } else {
    bounds = null;
  }

  visiting.delete(nodeId);
  cache.set(key, bounds);
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
