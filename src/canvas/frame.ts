import { shapeBounds, shapeCenter, unionWorldBounds } from "../model/bounds";
import { rotateAbout } from "../model/rotate";
import type { Bounds, Shape, Vec2 } from "../model/types";
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
}

/** Screen-space gap (px) between the top edge and the rotation handle. */
export const ROTATE_OFFSET = 22;

export function getSelectionFrame(shapes: Shape[]): SelectionFrame | null {
  if (shapes.length === 0) return null;
  if (shapes.length === 1) {
    const s = shapes[0];
    return {
      center: shapeCenter(s),
      rotation: s.rotation || 0,
      bounds: shapeBounds(s),
    };
  }
  const b = unionWorldBounds(shapes)!;
  return {
    center: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
    rotation: 0,
    bounds: b,
  };
}

/** World position of a resize handle on the frame. */
export function frameHandlePoint(frame: SelectionFrame, id: HandleId): Vec2 {
  const local = handlePoint(frame.bounds, id);
  return frame.rotation
    ? rotateAbout(frame.center, local, frame.rotation)
    : local;
}

/** World position of the rotation handle (a fixed screen gap above the top). */
export function frameRotationPoint(
  frame: SelectionFrame,
  scale: number
): Vec2 {
  const local = {
    x: frame.center.x,
    y: frame.bounds.y - ROTATE_OFFSET / scale,
  };
  return frame.rotation
    ? rotateAbout(frame.center, local, frame.rotation)
    : local;
}

/** The four oriented corners (nw, ne, se, sw) in world coordinates. */
export function frameCorners(frame: SelectionFrame): Vec2[] {
  return (["nw", "ne", "se", "sw"] as HandleId[]).map((id) =>
    frameHandlePoint(frame, id)
  );
}
