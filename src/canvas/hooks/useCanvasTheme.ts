import { useEffect, type RefObject } from "react";
import { readCanvasTheme, type CanvasTheme } from "../canvasTheme";

/** Re-resolve canvas colors whenever the active theme (data-theme) changes. */
export function useCanvasTheme(
  themeRef: RefObject<CanvasTheme>,
  scheduleDraw: () => void
) {
  useEffect(() => {
    const observer = new MutationObserver(() => {
      themeRef.current = readCanvasTheme();
      scheduleDraw();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [themeRef, scheduleDraw]);
}
