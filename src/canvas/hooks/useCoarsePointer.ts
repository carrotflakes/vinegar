import { useEffect, type RefObject } from "react";

/** Track whether the primary pointer is coarse (touch), repainting on change. */
export function useCoarsePointer(
  coarseRef: RefObject<boolean>,
  scheduleDraw: () => void
) {
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(pointer: coarse)");
    const update = () => {
      coarseRef.current = mq.matches;
      scheduleDraw();
    };
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [coarseRef, scheduleDraw]);
}
