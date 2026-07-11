import { worldShapeBounds } from "../model/bounds";
import { isShapeHidden } from "../model/groups";
import { matrixScale, shapeWorldMatrix } from "../model/matrix";
import { shapesInPaintOrder } from "../model/scene";
import type { Bounds, Document } from "../model/types";

/**
 * Tight content bounds of the document's visible shapes, expanded to include
 * stroke extents plus an extra margin. Returns null when nothing is visible.
 */
export function contentBounds(
  doc: Document,
  margin = 8
): Bounds | null {
  const shapes = shapesInPaintOrder(doc).filter((s) => !isShapeHidden(doc, s));
  if (shapes.length === 0) return null;

  // Expand each shape's box by half its stroke width, then add the margin.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const b = worldShapeBounds(doc, s);
    const half = s.stroke !== null
      ? (s.strokeWidth / 2) * matrixScale(shapeWorldMatrix(doc, s))
      : 0;
    minX = Math.min(minX, b.x - half);
    minY = Math.min(minY, b.y - half);
    maxX = Math.max(maxX, b.x + b.width + half);
    maxY = Math.max(maxY, b.y + b.height + half);
  }
  return {
    x: minX - margin,
    y: minY - margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
  };
}
