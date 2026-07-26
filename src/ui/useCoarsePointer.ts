import { useEffect, useState } from "react";

/**
 * True when the primary pointer is coarse (touch/pen), tracked live so an
 * iPad keyboard/trackpad being attached or removed updates the UI.
 *
 * The canvas has its own ref-based variant (`canvas/hooks/useCoarsePointer`)
 * that repaints instead of re-rendering; this one is for React components.
 */
export function useCoarsePointer(): boolean {
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
