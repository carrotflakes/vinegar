import { useRef } from "react";
import { canvasDropPlacement } from "../canvas/canvasDrag";
import type { Vec2 } from "../model/types";
import { useTouchDrag, type DragPoint } from "./useTouchDrag";
import "./panelDragGhost.css";

/** What the cursor-following preview shows for the item being dragged. */
export interface DragGhost {
  label?: string;
  imageSrc?: string;
}

export interface Placement {
  at: Vec2;
  fitWithin: { width: number; height: number };
}

/**
 * Pointer-based drag from a library panel onto the canvas, replacing HTML5
 * drag-and-drop so it works with touch. Mouse drags start on movement, touch on
 * a long-press. A floating ghost follows the pointer (there is no native drag
 * image), and a release over the canvas places the item at that point.
 *
 * Returns `startDrag(event, payload)` to wire to a row's `onPointerDown`.
 */
export function usePanelCanvasDrag<T>(config: {
  ghost: (payload: T) => DragGhost;
  onDrop: (payload: T, placement: Placement) => void;
}) {
  const cfg = useRef(config);
  cfg.current = config;
  const ghostEl = useRef<HTMLDivElement | null>(null);

  const moveGhost = (p: DragPoint) => {
    const g = ghostEl.current;
    if (g) {
      g.style.left = `${p.x}px`;
      g.style.top = `${p.y}px`;
    }
  };

  const removeGhost = () => {
    ghostEl.current?.remove();
    ghostEl.current = null;
  };

  return useTouchDrag<T>({
    // Shield the canvas from stray pointer events while dragging over it.
    capture: true,
    onStart: (payload, p) => {
      const g = document.createElement("div");
      g.className = "panel-drag-ghost";
      const { label, imageSrc } = cfg.current.ghost(payload);
      if (imageSrc) {
        const img = document.createElement("img");
        img.src = imageSrc;
        g.appendChild(img);
      }
      if (label) {
        const span = document.createElement("span");
        span.textContent = label;
        g.appendChild(span);
      }
      document.body.appendChild(g);
      ghostEl.current = g;
      moveGhost(p);
    },
    onMove: (_payload, p) => moveGhost(p),
    onDrop: (payload, p) => {
      removeGhost();
      if (!p.target?.closest(".canvas-wrap")) return;
      const placement = canvasDropPlacement(p.x, p.y);
      if (placement) cfg.current.onDrop(payload, placement);
    },
    onCancel: removeGhost,
  });
}
