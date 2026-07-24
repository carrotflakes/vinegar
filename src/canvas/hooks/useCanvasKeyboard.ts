import { useEffect, type RefObject } from "react";
import { useInput } from "../../store/inputStore";
import { type ToolContext } from "../interaction";
import { cancelActiveInteraction } from "../interactionLifecycle";
import { cancelPenDraft, commitPenDraft, undoPenAnchor } from "../tools/penTool";
import { isTypingTarget } from "../util";

/** Space-to-pan, physical-modifier mirroring, and pen draft finish/cancel keys. */
export function useCanvasKeyboard(
  ctx: ToolContext,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  spaceRef: RefObject<boolean>
) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Mirror physical modifiers so on-screen chips reflect held keys too.
      useInput.getState().setPhysical({ shift: e.shiftKey, alt: e.altKey });
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        spaceRef.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = "grab";
        return;
      }
      if (ctx.penDraft.current) {
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === "Enter") {
          e.preventDefault();
          commitPenDraft(ctx);
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelPenDraft(ctx);
        } else if (
          (mod && !e.shiftKey && e.key.toLowerCase() === "z") ||
          e.key === "Backspace" ||
          e.key === "Delete"
        ) {
          // Step back one anchor instead of running the document-level undo.
          e.preventDefault();
          e.stopImmediatePropagation();
          undoPenAnchor(ctx);
        }
        return;
      }
      // Escape aborts any in-progress drag (move/resize/rotate/marquee/…),
      // rolling the document back to before the interaction started.
      if (e.key === "Escape" && ctx.interaction.current.kind !== "none") {
        e.preventDefault();
        cancelActiveInteraction(ctx);
      }
    };
    const up = (e: KeyboardEvent) => {
      useInput.getState().setPhysical({ shift: e.shiftKey, alt: e.altKey });
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [ctx, canvasRef, spaceRef]);
}
