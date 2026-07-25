import type { Vec2 } from "../model/types";
import type { EditorState } from "../store/editorStore";
import type { ToolContext } from "./interaction";
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
  spacePan: boolean
): string {
  if (spacePan) return "grab";
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
