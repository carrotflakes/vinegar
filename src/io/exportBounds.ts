import { nodeWorldBounds, worldShapeBounds } from "../model/bounds";
import { clippingMask } from "../model/clippingMask";
import { matrixScale, shapeWorldMatrix } from "../model/matrix";
import {
  ancestorIds,
  isGroup,
  isNodeHidden,
  isShape,
  scopeLeafIds,
} from "../model/scene";
import type { Bounds, Document } from "../model/types";

function intersectBounds(a: Bounds, b: Bounds): Bounds | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right < x || bottom < y
    ? null
    : { x, y, width: right - x, height: bottom - y };
}

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
    b = {
      x: b.x - half,
      y: b.y - half,
      width: b.width + half * 2,
      height: b.height + half * 2,
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
