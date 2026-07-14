import { useEffect } from "react";

/**
 * Prevent browser page zoom gestures in the full-screen editor UI.
 *
 * The canvas still handles its own pinch and wheel gestures; cancelling the
 * browser defaults here only stops the page itself from being scaled.
 */
export function usePreventBrowserZoom() {
  useEffect(() => {
    const preventWheelZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const preventMultiTouchZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const preventGestureZoom = (e: Event) => e.preventDefault();

    window.addEventListener("wheel", preventWheelZoom, { passive: false });
    document.addEventListener("touchmove", preventMultiTouchZoom, {
      passive: false,
    });
    document.addEventListener("gesturestart", preventGestureZoom, {
      passive: false,
    });
    document.addEventListener("gesturechange", preventGestureZoom, {
      passive: false,
    });
    return () => {
      window.removeEventListener("wheel", preventWheelZoom);
      document.removeEventListener("touchmove", preventMultiTouchZoom);
      document.removeEventListener("gesturestart", preventGestureZoom);
      document.removeEventListener("gesturechange", preventGestureZoom);
    };
  }, []);
}
