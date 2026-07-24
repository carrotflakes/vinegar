import { useEditor } from "../store/editorStore";
import { setReadout } from "../store/pointerStore";
import type { ToolContext } from "./interaction";
import { cancelBrush } from "./tools/brushTool";
import { cancelEraser } from "./tools/eraserTool";

/** Discard any in-progress single-pointer tool op, rolling back the doc. */
export function cancelActiveInteraction(ctx: ToolContext): void {
  const inter = ctx.interaction.current;
  ctx.interaction.current = { kind: "none" };
  const state = useEditor.getState();
  ctx.guides.current = [];
  ctx.spacings.current = [];
  setReadout(null);
  switch (inter.kind) {
    case "move":
    case "resize":
    case "rotate":
    case "corner-radius":
    case "pivot":
    case "node-anchor":
    case "node-handle":
    case "artboard-move":
    case "artboard-resize":
      // These commit through begin/endInteraction; roll back the snapshot.
      state.cancelInteraction();
      break;
    case "artboard-create":
      state.cancelInteraction();
      state.selectArtboard(null);
      break;
    case "create":
    case "pencil":
      // Drag-time changes live only in the preview shape.
      ctx.preview.current = null;
      break;
    case "brush":
      // Also clear the brush tool's transient capture state.
      cancelBrush(ctx);
      break;
    case "eraser":
      cancelEraser(ctx);
      break;
    case "text-create":
      break;
    case "marquee":
      ctx.marquee.current = null;
      break;
    case "node-marquee":
      // Selection is updated live during the drag; roll it back.
      ctx.marquee.current = null;
      state.setEditNodes(inter.original);
      break;
    // "pan" / "pen-anchor" / "none": nothing to undo.
  }
  ctx.scheduleDraw();
}
