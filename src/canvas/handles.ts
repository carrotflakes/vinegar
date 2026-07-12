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

/** CSS cursor matching each handle's resize direction (unrotated). */
export function handleCursor(id: HandleId): string {
  return handleCursorRotated(id, 0);
}

/** Outward direction of each handle in screen space (degrees, y-down). */
const HANDLE_ANGLE: Record<HandleId, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};

const CURSOR_BUCKETS: { angle: number; cursor: string }[] = [
  { angle: 0, cursor: "ew-resize" },
  { angle: 45, cursor: "nwse-resize" },
  { angle: 90, cursor: "ns-resize" },
  { angle: 135, cursor: "nesw-resize" },
];

/**
 * CSS resize cursor for a handle, accounting for the selection's rotation so the
 * arrow points along the actual (rotated) edge. `rotation` is in radians.
 */
export function handleCursorRotated(id: HandleId, rotation: number): string {
  // Resize cursors are bidirectional, so collapse the direction to 0..180.
  const a = (((HANDLE_ANGLE[id] + (rotation * 180) / Math.PI) % 180) + 180) % 180;
  let best = CURSOR_BUCKETS[0];
  let bestDist = Infinity;
  for (const b of CURSOR_BUCKETS) {
    const d = Math.min(Math.abs(a - b.angle), 180 - Math.abs(a - b.angle));
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best.cursor;
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

/**
 * Constrain a freely-resized bounds to `ratio` (= width / height), keeping the
 * edge opposite the dragged handle fixed. Corner handles grow uniformly along
 * whichever axis moved more; edge handles drive the perpendicular axis and grow
 * it symmetrically about the fixed edge. Used for aspect-locked resizing.
 */
export function constrainAspectRatio(
  from: Bounds,
  handle: HandleId,
  free: Bounds,
  ratio: number
): Bounds {
  const horiz = handle.includes("e") || handle.includes("w");
  const vert = handle.includes("n") || handle.includes("s");

  let width: number;
  let height: number;
  if (horiz && vert) {
    // Corner: uniform scale by the axis that changed most.
    const scale = Math.max(free.width / from.width, free.height / from.height);
    width = from.width * scale;
    height = from.height * scale;
  } else if (horiz) {
    width = free.width;
    height = width / ratio;
  } else {
    height = free.height;
    width = height * ratio;
  }

  // Anchor: the fixed edge stays put; a free axis grows about its centre.
  const anchorX = handle.includes("w")
    ? from.x + from.width
    : handle.includes("e")
      ? from.x
      : from.x + from.width / 2;
  const anchorY = handle.includes("n")
    ? from.y + from.height
    : handle.includes("s")
      ? from.y
      : from.y + from.height / 2;

  const x = handle.includes("w")
    ? anchorX - width
    : handle.includes("e")
      ? anchorX
      : anchorX - width / 2;
  const y = handle.includes("n")
    ? anchorY - height
    : handle.includes("s")
      ? anchorY
      : anchorY - height / 2;

  return { x, y, width, height };
}
