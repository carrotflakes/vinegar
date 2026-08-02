import { nodeWorldBounds, unionNodeWorldBounds } from "@/model/geometry/bounds";
import {
  fitBoundsInViewport,
  flipHorizontallyAt,
  flipVerticallyAt,
  initialViewport,
  rotateAt,
  zoomAt,
} from "@/model/geometry/viewport";
import { contentBounds } from "@/io/exportBounds";
import { isFrame, selectionRoots } from "@/model/scene";
import type { Bounds, FrameNode } from "@/model/types";
import { currentFocusRoot } from "@/store/editorStore";
import { usePreferences } from "@/store/preferencesStore";
import type { EditorState } from "@/store/state";
import { toggleFullscreen } from "@/fullscreen";
import { canvasCenter, canvasViewportSize } from "./canvasPlacement";
import type { Command } from "./types";

/** The lone selected frame node, or null. */
function selectedFrame(state: EditorState): FrameNode | null {
  if (state.selection.length !== 1) return null;
  const node = state.doc.nodes[state.selection[0]];
  return isFrame(node) ? node : null;
}

/** Apply the shared padded fit calculation to the live canvas. */
function fitViewport(state: EditorState, bounds: Bounds | null): void {
  if (!bounds) return;
  state.setViewport(fitBoundsInViewport(bounds, canvasViewportSize()));
}

function selectionBounds(state: EditorState): Bounds | null {
  return unionNodeWorldBounds(
    state.doc,
    selectionRoots(state.doc, state.selection)
  );
}

function drawingBounds(state: EditorState): Bounds | null {
  return contentBounds(state.doc, 0, currentFocusRoot(state));
}

/** The selected guide's id, if one is selected and actually actionable. */
function selectedGuide(state: EditorState): string | null {
  const id = state.selectedGuideId;
  if (!id || state.guidesLocked || !state.guidesVisible) return null;
  return state.doc.guides.some((guide) => guide.id === id) ? id : null;
}

export const VIEW_COMMANDS: Command[] = [
  {
    id: "view.zoomIn",
    label: "Zoom in",
    group: "View",
    run: (state) =>
      state.setViewport(zoomAt(state.viewport, canvasCenter(), 1.2)),
  },
  {
    id: "view.zoomOut",
    label: "Zoom out",
    group: "View",
    run: (state) =>
      state.setViewport(zoomAt(state.viewport, canvasCenter(), 1 / 1.2)),
  },
  {
    id: "view.reset",
    label: "Reset view",
    group: "View",
    run: (state) => state.setViewport(initialViewport),
  },
  {
    id: "view.resetRotation",
    label: "Reset rotation",
    group: "View",
    enabled: (state) => state.viewport.rotation !== 0,
    run: (state) =>
      state.setViewport(
        rotateAt(state.viewport, canvasCenter(), -state.viewport.rotation)
      ),
  },
  {
    id: "view.flipHorizontal",
    label: "Flip view horizontally",
    group: "View",
    keys: [{ key: "F", shift: true }],
    run: (state) =>
      state.setViewport(flipHorizontallyAt(state.viewport, canvasCenter())),
  },
  {
    id: "view.flipVertical",
    label: "Flip view vertically",
    group: "View",
    run: (state) =>
      state.setViewport(flipVerticallyAt(state.viewport, canvasCenter())),
  },
  {
    id: "view.fitSelection",
    label: "Fit selection",
    group: "View",
    keys: [{ key: "2", shift: true }],
    enabled: (state) => selectionBounds(state) != null,
    run: (state) => fitViewport(state, selectionBounds(state)),
  },
  {
    id: "view.fitAll",
    label: "Fit all content",
    group: "View",
    keys: [{ key: "1", shift: true }],
    enabled: (state) => drawingBounds(state) != null,
    run: (state) => fitViewport(state, drawingBounds(state)),
  },
  {
    id: "view.fitFrame",
    label: "Fit frame",
    group: "View",
    enabled: (state) => selectedFrame(state) != null,
    run: (state) => {
      const frame = selectedFrame(state);
      fitViewport(
        state,
        frame ? nodeWorldBounds(state.doc, frame.id) : null
      );
    },
  },
  {
    id: "view.toggleSnap",
    label: "Toggle snapping",
    group: "View",
    run: (state) => state.toggleSnap(),
  },
  {
    id: "view.toggleGrid",
    label: "Toggle grid snapping",
    group: "View",
    run: (state) => state.toggleGridSnap(),
  },
  {
    id: "view.toggleGridVisible",
    label: "Toggle grid visibility",
    group: "View",
    run: (state) => state.toggleGridVisible(),
  },
  {
    id: "view.toggleRulers",
    label: "Toggle rulers",
    group: "View",
    run: (state) => state.toggleRulers(),
  },
  {
    id: "view.resetRulerOrigin",
    label: "Reset ruler origin to the document",
    group: "View",
    // Only meaningful while an active frame is actually driving the rulers.
    enabled: (state) =>
      state.activeFrameId !== null &&
      usePreferences.getState().canvas.rulerOrigin === "artboard",
    run: (state) => state.setActiveFrame(null),
  },
  {
    id: "view.toggleRulerOrigin",
    label: "Toggle ruler origin (artboard / document)",
    group: "View",
    run: () => {
      const preferences = usePreferences.getState();
      preferences.setRulerOrigin(
        preferences.canvas.rulerOrigin === "artboard" ? "world" : "artboard"
      );
    },
  },
  {
    id: "guides.toggleVisible",
    label: "Toggle guide visibility",
    group: "View",
    keys: [{ key: ";", mod: true }],
    run: (state) => state.toggleGuidesVisible(),
  },
  {
    id: "guides.toggleLock",
    label: "Toggle guide lock",
    group: "View",
    keys: [{ key: ";", mod: true, alt: true }],
    run: (state) => state.toggleGuidesLocked(),
  },
  {
    id: "guides.toggleSnap",
    label: "Toggle snapping to guides",
    group: "View",
    run: (state) => state.toggleGuideSnap(),
  },
  {
    id: "guides.delete",
    label: "Delete guide",
    group: "View",
    danger: true,
    enabled: (state) => selectedGuide(state) !== null,
    run: (state) => {
      const guide = selectedGuide(state);
      if (guide) state.removeGuide(guide);
    },
  },
  {
    id: "guides.clear",
    label: "Clear guides",
    group: "View",
    danger: true,
    enabled: (state) =>
      state.doc.guides.length > 0 && !state.guidesLocked,
    run: (state) => state.clearGuides(),
  },
  {
    id: "view.fullscreen",
    label: "Toggle fullscreen",
    group: "View",
    run: () => toggleFullscreen(),
  },
];
