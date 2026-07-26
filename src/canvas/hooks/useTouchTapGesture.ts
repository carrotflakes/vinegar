import { useCallback, useRef } from "react";
import type { Viewport } from "@/model/geometry/viewport";
import type { Vec2 } from "../../model/types";
import { useEditor } from "../../store/editorStore";

/** A multi-touch tap must lift within this long to count as a tap. */
const TAP_MAX_MS = 300;
/** Any contact travelling further than this makes it a drag, not a tap. */
const TAP_TOLERANCE = 16;

interface TapRun {
  /** Where each contact still on the glass landed, keyed by pointerId. */
  starts: Map<number, Vec2>;
  /** How many fingers were down at once — the tap's "arity". */
  maxPointers: number;
  startTime: number;
  /** Viewport before the run, restored so a tap leaves the view untouched. */
  startViewport: Viewport;
  moved: boolean;
}

export interface TouchTapGesture {
  /** Register a touch contact going down. */
  down: (pointerId: number, screen: Vec2) => void;
  /** Feed a touch move; large travel disqualifies the run. */
  move: (pointerId: number, screen: Vec2) => void;
  /**
   * Register a touch lifting. Once the last one is up, a qualifying run fires
   * undo (two fingers) or redo (three). Returns true when it fired, so the
   * caller can skip whatever the release would otherwise have done. The run
   * counts its own contacts, so it stays coherent even for contacts the palm
   * filter kept away from the tools.
   */
  up: (pointerId: number) => boolean;
  /** Abandon the current run (pointer cancel, or a gesture we can't undo). */
  reset: () => void;
}

/**
 * Two-finger tap = undo, three-finger tap = redo — the gesture pair iPad
 * painting apps have trained users to expect. A run starts at the first touch
 * and is judged when the last one lifts, so it coexists with the pinch
 * handler: a real pinch travels far enough to disqualify itself, and the small
 * viewport drift a near-still pinch may have applied is rolled back here.
 */
export function useTouchTapGesture(): TouchTapGesture {
  const runRef = useRef<TapRun | null>(null);

  const reset = useCallback(() => {
    runRef.current = null;
  }, []);

  const down = useCallback((pointerId: number, screen: Vec2) => {
    const run = runRef.current;
    if (!run) {
      runRef.current = {
        starts: new Map([[pointerId, screen]]),
        maxPointers: 1,
        startTime: performance.now(),
        startViewport: useEditor.getState().viewport,
        moved: false,
      };
      return;
    }
    run.starts.set(pointerId, screen);
    run.maxPointers = Math.max(run.maxPointers, run.starts.size);
  }, []);

  const move = useCallback((pointerId: number, screen: Vec2) => {
    const run = runRef.current;
    if (!run || run.moved) return;
    const start = run.starts.get(pointerId);
    if (!start) return;
    if (Math.hypot(screen.x - start.x, screen.y - start.y) > TAP_TOLERANCE) {
      run.moved = true;
    }
  }, []);

  const up = useCallback((pointerId: number) => {
    const run = runRef.current;
    if (!run) return false;
    run.starts.delete(pointerId);
    // Judge the run only once every finger has left the glass.
    if (run.starts.size > 0) return false;
    runRef.current = null;
    if (run.moved || performance.now() - run.startTime > TAP_MAX_MS) {
      return false;
    }
    if (run.maxPointers !== 2 && run.maxPointers !== 3) return false;
    const state = useEditor.getState();
    state.setViewport(run.startViewport);
    if (run.maxPointers === 2) state.undo();
    else state.redo();
    return true;
  }, []);

  return { down, move, up, reset };
}
