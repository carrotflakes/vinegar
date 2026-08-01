import { applyMatrix } from "@/model/geometry/matrix";
import type { SelectionFrame } from "@/model/geometry/selectionFrame";
import type { Vec2 } from "../model/types";
import { handlePoint, type HandleId } from "./handles";

export {
  frameNodeSelectionFrame,
  getSelectionFrame,
  isMixedFrameSelection,
  singleSelectedFrame,
  type SelectionFrame,
  type SelectionLeaf,
} from "@/model/geometry/selectionFrame";

/** Screen-space gap (px) between the top edge and the rotation handle. */
export const ROTATE_OFFSET = 22;

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
