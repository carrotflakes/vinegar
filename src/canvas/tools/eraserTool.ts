import { brushAnchor } from "@/model/brush/brushOutline";
import { IDENTITY } from "@/model/geometry/matrix";
import { type BrushShape, type Vec2 } from "../../model/types";
import { useBrush } from "../../store/brushStore";
import type { EditorState } from "../../store/editorStore";
import type { ToolContext } from "../interaction";

/** Transient capture state for the in-progress eraser drag. */
interface ActiveErase {
  points: Vec2[];
  /** Eraser disk diameter in world units. */
  size: number;
}

let active: ActiveErase | null = null;

/**
 * A translucent brush that visualizes the swept eraser band while dragging.
 * Its width equals the eraser diameter, so any brush centerline under the band
 * is what will be cut. Discarded (never committed) on finish.
 */
function previewShape(points: Vec2[], size: number): BrushShape {
  return {
    id: "eraser-preview",
    name: "Eraser",
    type: "brush",
    anchors: points.map((p) => brushAnchor(p, 1)),
    fill: null,
    stroke: { type: "solid", color: "#e5484d", alpha: 0.3 },
    strokeWidth: size,
    opacity: 1,
    transform: [...IDENTITY],
    transformOrigin: null,
  };
}

export function startEraser(
  ctx: ToolContext,
  world: Vec2,
  pointerId: number
) {
  const size = useBrush.getState().eraserSize;
  active = { points: [world], size };
  ctx.preview.current = previewShape(active.points, size);
  ctx.interaction.current = { kind: "eraser", pointerId };
  ctx.scheduleDraw();
}

export function onEraserMove(ctx: ToolContext, state: EditorState, world: Vec2) {
  if (!active) return;
  const minDist = 1.2 / state.viewport.scale;
  const last = active.points[active.points.length - 1];
  if (last && Math.hypot(world.x - last.x, world.y - last.y) < minDist) return;
  active.points.push(world);
  ctx.preview.current = previewShape(active.points, active.size);
  ctx.scheduleDraw();
}

export function finishEraser(ctx: ToolContext, state: EditorState) {
  const stroke = active;
  active = null;
  ctx.preview.current = null;
  if (stroke && stroke.points.length) {
    // Radius is half the diameter; the store splits brush centerlines within it.
    state.eraseBrushStrokes(stroke.points, stroke.size / 2);
  }
  ctx.scheduleDraw();
}

/** Drop the live eraser drag without applying it (tool switch / gesture). */
export function cancelEraser(ctx: ToolContext) {
  active = null;
  ctx.preview.current = null;
  ctx.scheduleDraw();
}
