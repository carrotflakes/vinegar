import { useEffect, useRef } from "react";
import { setDropdownOpen } from "@/store/menuStore";

/** Close a popover on an outside press or Escape.
 *
 * Listens for `pointerdown` rather than `mousedown`: the canvas captures
 * pointers on pointerdown, which suppresses the compatibility mouse events a
 * mousedown listener would rely on. Escape is handled in the capture phase and
 * stopped, so dismissing a popover doesn't also clear the selection — and an
 * inner popover closes before the one containing it.
 *
 * While open the popover registers with `menuStore`, so surfaces that own
 * Escape themselves (the global handler in App, the modal dialogs) yield to it.
 * `stopPropagation` alone cannot do that: a dialog listening on the same window
 * in the same phase was registered first and would still fire.
 *
 * `isInside` reports whether a press target belongs to the popover (its
 * trigger, its panel, or a nested picker portaled elsewhere).
 */
export function usePopoverDismiss(
  open: boolean,
  isInside: (target: Node) => boolean,
  onDismiss: () => void
) {
  // Held in a ref so the listeners always see the latest callbacks without
  // re-subscribing on every render.
  const latest = useRef({ isInside, onDismiss });
  latest.current = { isInside, onDismiss };

  useEffect(() => {
    if (!open) return;
    setDropdownOpen(true);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!latest.current.isInside(t)) latest.current.onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        latest.current.onDismiss();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      setDropdownOpen(false);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
}
