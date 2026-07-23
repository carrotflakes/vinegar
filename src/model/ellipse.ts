import { shapeBounds } from "@/model/geometry/bounds";
import type { EllipseShape, PathSubpath } from "./types";

/** Four cubic arcs approximating an ellipse in the shape's local space. */
export function ellipseSubpath(shape: EllipseShape): PathSubpath {
  const b = shapeBounds(shape);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const rx = b.width / 2;
  const ry = b.height / 2;
  const k = 0.5522847498307936;
  return {
    closed: true,
    anchors: [
      {
        p: { x: cx + rx, y: cy },
        hIn: { x: cx + rx, y: cy - k * ry },
        hOut: { x: cx + rx, y: cy + k * ry },
      },
      {
        p: { x: cx, y: cy + ry },
        hIn: { x: cx + k * rx, y: cy + ry },
        hOut: { x: cx - k * rx, y: cy + ry },
      },
      {
        p: { x: cx - rx, y: cy },
        hIn: { x: cx - rx, y: cy + k * ry },
        hOut: { x: cx - rx, y: cy - k * ry },
      },
      {
        p: { x: cx, y: cy - ry },
        hIn: { x: cx - k * rx, y: cy - ry },
        hOut: { x: cx + k * rx, y: cy - ry },
      },
    ],
  };
}
