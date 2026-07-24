import { useEffect, type RefObject } from "react";

/**
 * Workaround for an iOS Safari bug where two quick consecutive Apple Pencil
 * strokes drop the second one: the native touchstart default (focus/selection
 * handling) interrupts the fresh pointer sequence. Preventing that default and
 * keeping focus on the canvas container restores stroke delivery.
 *
 * The listener is attached natively (passive: false) because React's
 * onTouchStart cannot reliably call preventDefault.
 * See https://github.com/carrotflakes/cpaint/commit/f8b6c78.
 */
export function useTouchDrawFix(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  focusRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      focusRef.current?.focus();
    };
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    return () => canvas.removeEventListener("touchstart", onTouchStart);
  }, [canvasRef, focusRef]);
}
