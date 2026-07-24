import { useCallback, useRef, type RefObject } from "react";
import {
  rotateAt,
  snapAngleToQuarter,
  zoomAt,
  type Viewport,
} from "@/model/geometry/viewport";
import type { Vec2 } from "../../model/types";
import { useEditor } from "../../store/editorStore";
import { usePreferences } from "../../store/preferencesStore";
import { cancelActiveInteraction } from "../interactionLifecycle";
import type { ToolContext } from "../interaction";

interface GestureSnapshot {
  startDist: number;
  startAngle: number;
  startCenter: Vec2;
  startViewport: Viewport;
}

export interface CanvasGestures {
  /** Active pointers (canvas-relative screen coords), keyed by pointerId. */
  pointersRef: RefObject<Map<number, Vec2>>;
  /** The live two-finger gesture snapshot, or null when none is active. */
  gestureRef: RefObject<GestureSnapshot | null>;
  beginGesture: () => void;
  updateGesture: () => void;
}

/** Two-finger pinch-zoom / twist / pan gesture handling. */
export function useCanvasGestures(ctx: ToolContext): CanvasGestures {
  const pointersRef = useRef<Map<number, Vec2>>(new Map());
  const gestureRef = useRef<GestureSnapshot | null>(null);

  /** The centroid, spread and angle of the first two active pointers. */
  const twoPointerMetrics = useCallback(():
    | { center: Vec2; dist: number; angle: number }
    | null => {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return {
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }, []);

  const beginGesture = useCallback(() => {
    const m = twoPointerMetrics();
    if (!m) return;
    cancelActiveInteraction(ctx);
    gestureRef.current = {
      startDist: m.dist,
      startAngle: m.angle,
      startCenter: m.center,
      startViewport: useEditor.getState().viewport,
    };
  }, [ctx, twoPointerMetrics]);

  const updateGesture = useCallback(() => {
    const g = gestureRef.current;
    const m = twoPointerMetrics();
    if (!g || !m) return;
    const factor = m.dist > 0 && g.startDist > 0 ? m.dist / g.startDist : 1;
    // Twist rotation is opt-in; when enabled it can snap to quarter turns. The
    // snap targets the absolute orientation, so derive the delta from that.
    const canvas = usePreferences.getState().canvas;
    let delta = canvas.rotationEnabled ? m.angle - g.startAngle : 0;
    if (canvas.rotationEnabled && canvas.rotationSnap) {
      const target = snapAngleToQuarter(g.startViewport.rotation + delta);
      delta = target - g.startViewport.rotation;
    }
    // Zoom and twist around the initial centroid (both keep it fixed), then pan
    // so that world point stays pinned under the current, moving centroid.
    const zoomed = zoomAt(g.startViewport, g.startCenter, factor);
    const rotated = rotateAt(zoomed, g.startCenter, delta);
    useEditor.getState().setViewport({
      ...rotated,
      offset: {
        x: rotated.offset.x + (m.center.x - g.startCenter.x),
        y: rotated.offset.y + (m.center.y - g.startCenter.y),
      },
    });
    ctx.scheduleDraw();
  }, [ctx, twoPointerMetrics]);

  return { pointersRef, gestureRef, beginGesture, updateGesture };
}
