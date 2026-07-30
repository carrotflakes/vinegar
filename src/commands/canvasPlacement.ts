import { screenToWorld, type ViewportSize } from "@/model/geometry/viewport";
import type { Vec2 } from "@/model/types";
import type { ImportedSvg } from "@/io/importSvg";
import type { ClipboardPayload } from "@/store/docOps";
import { useEditor } from "@/store/editorStore";

/** Size of the drawable canvas area in CSS pixels. */
export function canvasViewportSize(): ViewportSize {
  const el = document.querySelector(".canvas-wrap");
  if (!el) return { width: window.innerWidth, height: window.innerHeight };
  const rect = el.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

/** Center of the canvas viewport in screen coordinates. */
export function canvasCenter(): Vec2 {
  const size = canvasViewportSize();
  return { x: size.width / 2, y: size.height / 2 };
}

function centeredPlacement(at?: Vec2): {
  at: Vec2;
  fitWithin: { width: number; height: number };
} {
  const state = useEditor.getState();
  const center = canvasCenter();
  return {
    at: at ?? screenToWorld(state.viewport, center),
    fitWithin: {
      width: ((center.x * 2) / state.viewport.scale) * 0.8,
      height: ((center.y * 2) / state.viewport.scale) * 0.8,
    },
  };
}

/**
 * Place already-obtained image files, fitting oversized ones into about 80% of
 * the visible plane. `at` overrides the default viewport center.
 */
export async function placeImagesFitted(files: File[], at?: Vec2): Promise<void> {
  const placement = centeredPlacement(at);
  await useEditor
    .getState()
    .placeImageFiles(files, placement.at, placement.fitWithin);
}

/** Place converted SVG content at the viewport center unless `at` is given. */
export function placeSvgFitted(imported: ImportedSvg, at?: Vec2): void {
  const placement = centeredPlacement(at);
  useEditor
    .getState()
    .placeImportedSvg(imported, placement.at, placement.fitWithin);
}

/**
 * Paste a payload recovered from another tab or session. Foreign document
 * coordinates are not meaningful here, so the payload lands in the viewport.
 */
export function pasteForeignPayload(
  payload: ClipboardPayload,
  at?: Vec2
): boolean {
  const state = useEditor.getState();
  return state.pastePayload(
    payload,
    at ?? screenToWorld(state.viewport, canvasCenter())
  );
}
