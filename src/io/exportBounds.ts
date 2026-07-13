import { nodeWorldBounds, worldShapeBounds } from "../model/bounds";
import { matrixScale, shapeWorldMatrix } from "../model/matrix";
import { isNodeHidden, isShape, scopeLeafIds } from "../model/scene";
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
  const ids = scopeLeafIds(doc, symbolId).filter((id) => !isNodeHidden(doc, id));
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
      half = node.stroke !== null
        ? (node.strokeWidth / 2) * matrixScale(shapeWorldMatrix(doc, node))
        : 0;
    } else {
      b = nodeWorldBounds(doc, id);
    }
    if (!b) continue;
    minX = Math.min(minX, b.x - half);
    minY = Math.min(minY, b.y - half);
    maxX = Math.max(maxX, b.x + b.width + half);
    maxY = Math.max(maxY, b.y + b.height + half);
  }
  if (minX === Infinity) return null;
  return {
    x: minX - margin,
    y: minY - margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
  };
}
