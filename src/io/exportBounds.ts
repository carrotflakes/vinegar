import { shapeBounds, unionBounds } from "../model/bounds";
import type { Bounds, Document, Shape } from "../model/types";

/**
 * Tight content bounds of a document, expanded to include stroke extents
 * plus an extra margin. Returns null when the document is empty.
 */
export function contentBounds(
  doc: Document,
  margin = 8
): Bounds | null {
  const shapes = doc.order
    .map((id) => doc.shapes[id])
    .filter(Boolean) as Shape[];
  if (!unionBounds(shapes)) return null;

  // Expand each shape's box by half its stroke width, then add the margin.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const b = shapeBounds(s);
    const half = s.stroke !== null ? s.strokeWidth / 2 : 0;
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
