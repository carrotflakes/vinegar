import type { Vec2 } from "../model/types";
import type { EditorState } from "../store/editorStore";
import { pickGuide } from "./guides";
import type { ToolContext } from "./interaction";
import { rulerBandAt, overRulers } from "./rulers";
import { frameCursor } from "./tools/frameTool";
import { nodeCursor } from "./tools/nodeTool";
import { penPencilCursor } from "./tools/penTool";
import { selectCursor } from "./tools/selectTool";

/** The CSS cursor for the current tool at the hovered point. */
export function resolveCursor(
  ctx: ToolContext,
  state: EditorState,
  screen: Vec2,
  world: Vec2,
  spacePan: boolean,
  size: { width: number; height: number }
): string {
  if (spacePan) return "grab";
  // Guides answer before the tools do, matching the pointer-down order.
  if (state.rulersVisible && overRulers(screen, size)) {
    if (state.guidesVisible && !state.guidesLocked) {
      const band = rulerBandAt(screen, size);
      if (band === "horizontal") return "ns-resize";
      if (band === "vertical") return "ew-resize";
    }
    return "default";
  }
  if (
    state.guidesVisible &&
    !state.guidesLocked &&
    (state.tool === "select" || state.tool === "node")
  ) {
    const guide = pickGuide(state.doc, state.viewport, screen, size, 4 * ctx.hitScale());
    if (guide) return guide.axis === "x" ? "ew-resize" : "ns-resize";
  }
  switch (state.tool) {
    case "pen":
    case "pencil":
      return penPencilCursor(ctx, state, screen);
    case "node":
      return nodeCursor(ctx, screen, world);
    case "frame":
      return frameCursor();
    case "text":
      return "text";
    case "brush":
    case "eraser":
    case "bucket":
      return "crosshair";
    default:
      return selectCursor(ctx, screen, world);
  }
}
