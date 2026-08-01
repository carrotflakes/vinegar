import { usePenDraftInfo } from "../store/penDraftStore";
import type { ToolContext } from "./interaction";
import {
  cancelPenDraft,
  closePenDraft,
  commitPenDraft,
  undoPenAnchor,
} from "./tools/penTool";
import "./PenDraftBar.css";

/**
 * On-screen controls for the pen's in-progress path. Finishing (Enter),
 * stepping back an anchor (Cmd+Z) and closing (clicking the first anchor) are
 * otherwise keyboard- or precision-only, which leaves a tablet with no way to
 * end a path at all. Shown on every pointer type: the shortcuts stay, this is
 * the discoverable copy of them.
 */
export default function PenDraftBar({ ctx }: { ctx: ToolContext }) {
  const anchors = usePenDraftInfo((s) => s.anchors);
  if (anchors === 0) return null;

  // Never take focus: a focused button would be re-fired by the Space the
  // canvas uses for panning, and by the Enter the draft uses to finish.
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <div
      className="pen-bar"
      role="group"
      aria-label="Pen path"
      // Let focused buttons own Enter/Space instead of the canvas and app-wide
      // keyboard handlers treating those keys as pen or command shortcuts.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        className="pen-bar-btn"
        disabled={anchors < 2}
        title="Finish the path (Enter)"
        onPointerDown={keepFocus}
        onClick={() => commitPenDraft(ctx)}
      >
        Done
      </button>
      <button
        className="pen-bar-btn"
        disabled={anchors < 2}
        title="Close and finish the path"
        onPointerDown={keepFocus}
        onClick={() => closePenDraft(ctx)}
      >
        Close
      </button>
      <button
        className="pen-bar-btn"
        title="Remove the last anchor (⌘Z / Backspace)"
        onPointerDown={keepFocus}
        onClick={() => undoPenAnchor(ctx)}
      >
        Undo
      </button>
      <button
        className="pen-bar-btn"
        title="Discard the whole path"
        onPointerDown={keepFocus}
        onClick={() => cancelPenDraft(ctx)}
      >
        Discard
      </button>
    </div>
  );
}
