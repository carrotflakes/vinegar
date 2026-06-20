import { shapeBounds, shapeCenter } from "../model/bounds";
import { rotateAbout, rotateVec } from "../model/rotate";
import { resizeShapeToBounds, translateShape } from "../model/transforms";
import type { Shape, Vec2 } from "../model/types";
import { resizeBounds, type HandleId } from "./handles";

/**
 * Resize a single (possibly rotated) shape by dragging `handle` to `pointer`.
 *
 * The resize happens in the shape's unrotated local frame; afterwards the shape
 * is translated by `(I - R) * (cOld - cNew)` so the opposite handle stays put in
 * world space. With rotation 0 this reduces to a plain opposite-corner resize.
 */
export function resizeSingleShape(
  shape: Shape,
  handle: HandleId,
  pointer: Vec2
): Shape {
  const local = shapeBounds(shape);
  const c = shapeCenter(shape);
  const r = shape.rotation || 0;

  const pLocal = r ? rotateAbout(c, pointer, -r) : pointer;
  const newLocal = resizeBounds(local, handle, pLocal);
  const scaled = resizeShapeToBounds(shape, local, newLocal);
  if (!r) return scaled;

  const cNew = {
    x: newLocal.x + newLocal.width / 2,
    y: newLocal.y + newLocal.height / 2,
  };
  const diff: Vec2 = { x: c.x - cNew.x, y: c.y - cNew.y };
  const rd = rotateVec(diff, r);
  return translateShape(scaled, diff.x - rd.x, diff.y - rd.y);
}
