import { useEditor } from "../store/editorStore";
import { useInput } from "../store/inputStore";
import { usePreferences } from "../store/preferencesStore";
import { useCoarsePointer } from "../ui/useCoarsePointer";
import { DRAWING_TOOLS } from "./inputRouting";
import "./ModifierBar.css";

/**
 * On-screen Shift/Alt toggles for touch, where tool constraints (Shift = 45°/
 * square, Alt = from-center/break-symmetry) have no physical keys. Toggles are
 * sticky; they also light up while the matching physical key is held. Read
 * through inputStore.readModifiers so tools honour keys and toggles alike.
 *
 * On the painting tools it also carries the finger-drawing switch. That state
 * is otherwise invisible — "why does my finger not draw any more?" — and it is
 * worth flipping mid-drawing, which a trip to Preferences is not.
 * See docs/pen-and-touch.md.
 */
export default function ModifierBar() {
  const coarse = useCoarsePointer();
  const stickyShift = useInput((s) => s.stickyShift);
  const stickyAlt = useInput((s) => s.stickyAlt);
  const physShift = useInput((s) => s.physShift);
  const physAlt = useInput((s) => s.physAlt);
  const toggleStickyShift = useInput((s) => s.toggleStickyShift);
  const toggleStickyAlt = useInput((s) => s.toggleStickyAlt);
  const tool = useEditor((s) => s.tool);
  const fingerDrawing = usePreferences((s) => s.canvas.fingerDrawing);
  const setFingerDrawing = usePreferences((s) => s.setFingerDrawing);

  if (!coarse) return null;

  return (
    <div className="modifier-bar" role="group" aria-label="Modifier keys">
      <button
        className={"modifier-btn" + (stickyShift || physShift ? " active" : "")}
        aria-pressed={stickyShift}
        onClick={toggleStickyShift}
      >
        Shift
      </button>
      <button
        className={"modifier-btn" + (stickyAlt || physAlt ? " active" : "")}
        aria-pressed={stickyAlt}
        onClick={toggleStickyAlt}
      >
        Alt
      </button>
      {DRAWING_TOOLS.has(tool) && (
        <button
          className={"modifier-btn" + (fingerDrawing ? " active" : "")}
          aria-pressed={fingerDrawing}
          title={
            fingerDrawing
              ? "Finger draws — tap to let it pan instead"
              : "Finger pans; the pen draws — tap to draw with the finger too"
          }
          onClick={() => setFingerDrawing(!fingerDrawing)}
        >
          Finger
        </button>
      )}
    </div>
  );
}
