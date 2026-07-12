import { useEffect, useState } from "react";
import { useInput } from "../store/inputStore";

/** True when the primary pointer is coarse (touch/pen), tracked live. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return coarse;
}

/**
 * On-screen Shift/Alt toggles for touch, where tool constraints (Shift = 45°/
 * square, Alt = from-center/break-symmetry) have no physical keys. Toggles are
 * sticky; they also light up while the matching physical key is held. Read
 * through inputStore.readModifiers so tools honour keys and toggles alike.
 */
export default function ModifierBar() {
  const coarse = useCoarsePointer();
  const stickyShift = useInput((s) => s.stickyShift);
  const stickyAlt = useInput((s) => s.stickyAlt);
  const physShift = useInput((s) => s.physShift);
  const physAlt = useInput((s) => s.physAlt);
  const toggleStickyShift = useInput((s) => s.toggleStickyShift);
  const toggleStickyAlt = useInput((s) => s.toggleStickyAlt);

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
    </div>
  );
}
