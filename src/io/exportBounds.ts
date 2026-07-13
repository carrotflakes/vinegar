import {
  intersectBounds,
  nodeWorldBounds,
  worldShapeBounds,
} from "../model/bounds";
import { clippingMask } from "../model/clippingMask";
import { effectsMargin } from "../model/effects";
import { matrixScale, nodeWorldMatrix, shapeWorldMatrix } from "../model/matrix";
import {
  ancestorIds,
  isGroup,
  isNodeHidden,
  isShape,
  scopeLeafIds,
} from "../model/scene";
import type { Bounds, Document } from "../model/types";

/**
 * Tight content bounds of the document's visible leaves (shapes and symbol
 * instances), expanded to include stroke extents plus an extra margin.
 * Instance bounds ignore stroke extents of their content. Returns null when
 * nothing is visible.
 */
export function contentBounds(
  doc: Document,
  margin = 8,
  symbolId: string | null = null
): Bounds | null {
  const masks = new Set(
    Object.values(doc.nodes)
      .filter(isGroup)
      .map((group) => clippingMask(doc, group)?.id)
      .filter((id): id is string => !!id)
  );
  const ids = scopeLeafIds(doc, symbolId).filter((id) => {
    if (!masks.has(id)) return !isNodeHidden(doc, id);
    // A mask's own hidden flag is ignored by clipping. Hidden ancestors still
    // suppress the entire group, so do not let such a mask create bounds.
    return !ancestorIds(doc, id).some(
      (ancestorId) => doc.nodes[ancestorId]?.hidden
    );
  });
  if (ids.length === 0) return null;

  // Expand each shape's box by half its stroke width, then add the margin.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const node = doc.nodes[id];
    let b: Bounds | null;
    let half = 0;
    if (isShape(node)) {
      b = worldShapeBounds(doc, node);
      half = !masks.has(id) && node.stroke !== null
        ? (node.strokeWidth / 2) * matrixScale(shapeWorldMatrix(doc, node))
        : 0;
    } else {
      b = nodeWorldBounds(doc, id);
    }
    if (!b) continue;
    // Effects (drop shadow / blur) extend the visual beyond geometry. Include
    // the leaf's own effects plus any on its ancestor groups/instances so the
    // crop never clips them. A mask deliberately ignores the mask shape's own
    // effects, matching the clipping model.
    let effectPad = masks.has(id) ? 0 : effectsMargin(node.effects) * matrixScale(nodeWorldMatrix(doc, id));
    for (const ancestorId of ancestorIds(doc, id)) {
      const ancestor = doc.nodes[ancestorId];
      effectPad += effectsMargin(ancestor?.effects) * matrixScale(nodeWorldMatrix(doc, ancestorId));
    }
    const pad = half + effectPad;
    b = {
      x: b.x - pad,
      y: b.y - pad,
      width: b.width + pad * 2,
      height: b.height + pad * 2,
    };
    // A clipped descendant cannot expand the export range beyond any of its
    // ancestor masks. The mask itself remains a bounds-bearing leaf, matching
    // the clipping group's selection/world AABB.
    for (const ancestorId of ancestorIds(doc, id)) {
      const ancestor = doc.nodes[ancestorId];
      if (!isGroup(ancestor)) continue;
      const mask = clippingMask(doc, ancestor);
      if (!mask) continue;
      b = intersectBounds(b, worldShapeBounds(doc, mask));
      if (!b) break;
    }
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (minX === Infinity) return null;
  return {
    x: minX - margin,
    y: minY - margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
  };
}
