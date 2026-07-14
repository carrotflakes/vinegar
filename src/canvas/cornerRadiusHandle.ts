import { shapeBounds } from "../model/bounds";
import { applyMatrix, shapeWorldMatrix } from "../model/matrix";
import {
  effectiveRectCornerRadius,
  maxRectCornerRadius,
} from "../model/roundedRect";
import type { Document, Vec2 } from "../model/types";
import { worldToScreen, type Viewport } from "../model/viewport";

export const CORNER_RADIUS_HANDLE_SIZE = 7;
const HANDLE_INSET = 14;

export interface CornerRadiusControl {
  shapeId: string;
  /** Screen-space center of the visible control. */
  point: Vec2;
  /** Screen-space direction in which the radius increases. */
  direction: Vec2;
  /** Screen pixels along `direction` representing one local radius unit. */
  pixelsPerRadius: number;
  maxRadius: number;
  radius: number;
}

/**
 * Geometry for the one shared-radius control shown inside a directly selected
 * rectangle. Insets keep it clear of the corner resize handle and center pivot.
 */
export function cornerRadiusControl(
  doc: Document,
  selection: string[],
  viewport: Viewport,
  chromeScale = 1
): CornerRadiusControl | null {
  if (selection.length !== 1) return null;
  const shape = doc.nodes[selection[0]];
  if (shape?.type !== "rect") return null;
  const maxRadius = maxRectCornerRadius(shape);
  if (maxRadius <= 0) return null;

  const bounds = shapeBounds(shape);
  const matrix = shapeWorldMatrix(doc, shape);
  const corner = worldToScreen(
    viewport,
    applyMatrix(matrix, { x: bounds.x, y: bounds.y })
  );
  const limit = worldToScreen(
    viewport,
    applyMatrix(matrix, {
      x: bounds.x + maxRadius,
      y: bounds.y + maxRadius,
    })
  );
  const dx = limit.x - corner.x;
  const dy = limit.y - corner.y;
  const length = Math.hypot(dx, dy);
  const inset = HANDLE_INSET * chromeScale;
  if (length < inset * 2 + CORNER_RADIUS_HANDLE_SIZE * chromeScale) return null;

  const direction = { x: dx / length, y: dy / length };
  const radius = effectiveRectCornerRadius(shape);
  const authoredDistance = (radius / maxRadius) * length;
  const distance = Math.max(inset, Math.min(length - inset, authoredDistance));
  return {
    shapeId: shape.id,
    point: {
      x: corner.x + direction.x * distance,
      y: corner.y + direction.y * distance,
    },
    direction,
    pixelsPerRadius: length / maxRadius,
    maxRadius,
    radius,
  };
}
