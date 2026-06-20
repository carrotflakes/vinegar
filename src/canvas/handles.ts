import type { Bounds, Vec2 } from "../model/types";

export type HandleId =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

export const HANDLE_IDS: HandleId[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

/** Screen-space size (px) of a resize handle square. */
export const HANDLE_SIZE = 9;

/** World-space anchor point for each handle on a bounds rect. */
export function handlePoint(b: Bounds, id: HandleId): Vec2 {
  const { x, y, width: w, height: h } = b;
  switch (id) {
    case "nw":
      return { x, y };
    case "n":
      return { x: x + w / 2, y };
    case "ne":
      return { x: x + w, y };
    case "e":
      return { x: x + w, y: y + h / 2 };
    case "se":
      return { x: x + w, y: y + h };
    case "s":
      return { x: x + w / 2, y: y + h };
    case "sw":
      return { x, y: y + h };
    case "w":
      return { x, y: y + h / 2 };
  }
}

/** CSS cursor matching each handle's resize direction. */
export function handleCursor(id: HandleId): string {
  switch (id) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
  }
}

/**
 * Resize a bounds by dragging `handle` so its anchor moves to world `pointer`.
 * The opposite corner/edge stays fixed.
 */
export function resizeBounds(
  b: Bounds,
  handle: HandleId,
  pointer: Vec2
): Bounds {
  let left = b.x;
  let top = b.y;
  let right = b.x + b.width;
  let bottom = b.y + b.height;

  if (handle.includes("w")) left = pointer.x;
  if (handle.includes("e")) right = pointer.x;
  if (handle.includes("n")) top = pointer.y;
  if (handle.includes("s")) bottom = pointer.y;

  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  };
}
