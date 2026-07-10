import { shapeBounds, unionWorldBounds } from "../model/bounds";
import {
  applyMatrix,
  groupWorldMatrix,
  invertMatrix,
  matrixAngle,
  multiply,
  shapeWorldMatrix,
  transformBounds,
} from "../model/matrix";
import type { Bounds, Document, Group, Matrix, Shape, Vec2 } from "../model/types";
import { handlePoint, type HandleId } from "./handles";

/**
 * An oriented frame around the current selection.
 * - Single shape: `bounds` is the shape's local geometry box and `rotation`
 *   its own rotation, so the frame is oriented with the shape.
 * - Multiple shapes: `bounds` is the world AABB and `rotation` is 0.
 */
export interface SelectionFrame {
  center: Vec2;
  rotation: number;
  bounds: Bounds;
  transform: Matrix;
}

/** Screen-space gap (px) between the top edge and the rotation handle. */
export const ROTATE_OFFSET = 22;

export function getSelectionFrame(
  doc: Document,
  shapes: Shape[],
  group?: Group | null
): SelectionFrame | null {
  if (shapes.length === 0) return null;
  if (group) {
    const transform = groupWorldMatrix(doc, group.id);
    const inverse = invertMatrix(transform);
    if (inverse) {
      const localBounds = shapes.map((shape) =>
        transformBounds(
          shapeBounds(shape),
          multiply(inverse, shapeWorldMatrix(doc, shape))
        )
      );
      const x = Math.min(...localBounds.map((b) => b.x));
      const y = Math.min(...localBounds.map((b) => b.y));
      const right = Math.max(...localBounds.map((b) => b.x + b.width));
      const bottom = Math.max(...localBounds.map((b) => b.y + b.height));
      const bounds = { x, y, width: right - x, height: bottom - y };
      return {
        center: applyMatrix(transform, {
          x: x + bounds.width / 2,
          y: y + bounds.height / 2,
        }),
        rotation: matrixAngle(transform),
        bounds,
        transform,
      };
    }
  }
  if (shapes.length === 1) {
    const s = shapes[0];
    const bounds = shapeBounds(s);
    const transform = shapeWorldMatrix(doc, s);
    return {
      center: applyMatrix(transform, {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      }),
      rotation: matrixAngle(transform),
      bounds,
      transform,
    };
  }
  const b = unionWorldBounds(doc, shapes)!;
  return {
    center: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
    rotation: 0,
    bounds: b,
    transform: [1, 0, 0, 1, 0, 0],
  };
}

/** World position of a resize handle on the frame. */
export function frameHandlePoint(frame: SelectionFrame, id: HandleId): Vec2 {
  const local = handlePoint(frame.bounds, id);
  return applyMatrix(frame.transform, local);
}

/** World position of the rotation handle (a fixed screen gap above the top). */
export function frameRotationPoint(
  frame: SelectionFrame,
  scale: number
): Vec2 {
  const top = applyMatrix(frame.transform, {
    x: frame.bounds.x + frame.bounds.width / 2,
    y: frame.bounds.y,
  });
  const up = { x: -frame.transform[2], y: -frame.transform[3] };
  const length = Math.hypot(up.x, up.y) || 1;
  const gap = ROTATE_OFFSET / scale;
  return {
    x: top.x + (up.x / length) * gap,
    y: top.y + (up.y / length) * gap,
  };
}

/** The four oriented corners (nw, ne, se, sw) in world coordinates. */
export function frameCorners(frame: SelectionFrame): Vec2[] {
  return (["nw", "ne", "se", "sw"] as HandleId[]).map((id) =>
    frameHandlePoint(frame, id)
  );
}
