import { useEditor } from "../store/editorStore";
import { setReadout } from "../store/pointerStore";
import type { ToolContext } from "./interaction";
import { cancelBrush } from "./tools/brushTool";
import { cancelEraser } from "./tools/eraserTool";
import { resetPencilStroke } from "./tools/shapeTools";
import { usePenDraftInfo } from "../store/penDraftStore";

/**
 * Throw away every trace of an in-progress tool op *without* touching the
 * store — for when the document itself has just been replaced (new / open /
 * recover, see `_docEpoch`). Rolling back through history would be wrong here:
 * the snapshot those rollbacks restore belongs to the previous document, and
 * committing would drop a stray shape into the fresh one.
 */
export function discardCanvasTransients(ctx: ToolContext): void {
  ctx.interaction.current = { kind: "none" };
  ctx.penDraft.current = null;
  ctx.penExtend.current = null;
  ctx.preview.current = null;
  ctx.hover.current = null;
  ctx.marquee.current = null;
  ctx.brushHover.current = null;
  ctx.endpointHint.current = null;
  ctx.closeHint.current = null;
  ctx.lastInsert.current = null;
  ctx.guides.current = [];
  ctx.spacings.current = [];
  resetPencilStroke();
  cancelBrush(ctx);
  cancelEraser(ctx);
  usePenDraftInfo.getState().setAnchors(0);
  setReadout(null);
  ctx.scheduleDraw();
}

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
    case "generator-param":
    case "pivot":
    case "node-anchor":
    case "node-handle":
    case "node-width":
      // These commit through begin/endInteraction; roll back the snapshot.
      state.cancelInteraction();
      break;
    case "frame-create":
      state.cancelInteraction();
      state.clearSelection();
      break;
    case "guide-drag":
      // Rolls the guide back to where the drag started (or away entirely, if
      // the drag is what created it).
      state.cancelInteraction();
      if (inter.created) state.setSelectedGuide(null);
      break;
    case "create":
      // Drag-time changes live only in the preview shape.
      ctx.preview.current = null;
      break;
    case "pencil":
      ctx.preview.current = null;
      // Also drop the capture state (and its copy of the extended path) and
      // the close ring, instead of leaving them for the next stroke to reset.
      ctx.closeHint.current = null;
      resetPencilStroke();
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
    // "pan" / "pen-anchor" / "select-pending" / "none": nothing to undo — a
    // pending press never opened an undo step or touched the document.
  }
  ctx.scheduleDraw();
}
