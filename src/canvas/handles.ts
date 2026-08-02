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

/**
 * Screen-space size (px) of a parameter knob — the diamonds that tune a value
 * in place rather than move or resize anything (corner radius, generator args,
 * brush width). One size and one shape for the whole family.
 */
export const PARAM_KNOB_SIZE = 8;

/**
 * The handles worth showing for a box: a selection with no extent on an axis
 * (a straight line, a single point) can never be resized along it — a scale of
 * zero has no way back — and drawing eight handles on top of each other only
 * makes the two that do work unpickable. Rendering and hit-testing share this,
 * so an unseen handle is never grabbed by accident.
 */
export function usableHandleIds(b: Bounds): HandleId[] {
  const flatX = Math.abs(b.width) < 1e-6;
  const flatY = Math.abs(b.height) < 1e-6;
  if (flatX && flatY) return [];
  if (flatX) return ["n", "s"];
  if (flatY) return ["e", "w"];
  return HANDLE_IDS;
}

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
 * CSS resize cursor for a handle, accounting for the selection/view rotation so
 * the arrow points along the actual edge on screen. `rotation` is in radians;
 * `mirrored` reflects the handle direction across the screen's vertical axis.
 */
export function handleCursorRotated(
  id: HandleId,
  rotation: number,
  mirrored: boolean,
): string {
  // Resize cursors are bidirectional, so collapse the direction to 0..180.
  const handleAngle = mirrored ? -HANDLE_ANGLE[id] : HANDLE_ANGLE[id];
  const a = (((handleAngle + (rotation * 180) / Math.PI) % 180) + 180) % 180;
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
 * The opposite corner/edge stays fixed. Width and height are intentionally
 * signed: crossing the fixed edge produces a negative scale on that axis.
 */
export function resizeBounds(
  b: Bounds,
  handle: HandleId,
  pointer: Vec2
): Bounds {
  return {
    x: handle.includes("w") ? pointer.x : b.x,
    y: handle.includes("n") ? pointer.y : b.y,
    width: handle.includes("w")
      ? b.x + b.width - pointer.x
      : handle.includes("e")
        ? pointer.x - b.x
        : b.width,
    height: handle.includes("n")
      ? b.y + b.height - pointer.y
      : handle.includes("s")
        ? pointer.y - b.y
        : b.height,
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
    // Corner: uniform scale by the axis that changed most, while each pointer
    // coordinate independently decides whether its axis has crossed over.
    const scale = Math.max(
      Math.abs(free.width / from.width),
      Math.abs(free.height / from.height)
    );
    width = from.width * scale * (free.width < 0 ? -1 : 1);
    height = from.height * scale * (free.height < 0 ? -1 : 1);
  } else if (horiz) {
    width = free.width;
    height = Math.abs(width) / ratio;
  } else {
    height = free.height;
    width = Math.abs(height) * ratio;
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
