import { useCallback, useRef } from "react";
import type { Vec2 } from "../../model/types";
import { isDoubleTap, TAP_MAX_MS, travelExceeds, type SingleTap } from "../inputRouting";

export interface TouchDoubleTap {
  /**
   * Register a touch contact going down. `lone` is false when another finger
   * was already on the glass — a gesture can never be half of a double tap.
   */
  down: (pointerId: number, screen: Vec2, lone: boolean) => void;
  /** Feed a touch move; travel past the click slop disqualifies the tap. */
  move: (pointerId: number, screen: Vec2) => void;
  /**
   * Register a touch lifting. Returns true when this contact was the second
   * tap of a double tap, so the caller can run the drill-in the mouse gets
   * from `dblclick`.
   */
  up: (pointerId: number, screen: Vec2) => boolean;
  /** Abandon whatever was brewing (pointer cancel, pen takeover, gesture). */
  reset: () => void;
}

interface PendingTap {
  pointerId: number;
  screen: Vec2;
  startTime: number;
  moved: boolean;
}

/**
 * One-finger double tap on the canvas, the touch counterpart of a mouse
 * double-click: the canvas sets `touch-action: none`, so browsers never
 * synthesise `dblclick` from touch and drilling into a group would otherwise
 * be unreachable without a mouse.
 *
 * Two- and three-finger taps (undo/redo, `useTouchTapGesture`) are judged from
 * the same events but never collide: a run with a second finger down is
 * dropped here at `down`.
 */
export function useTouchDoubleTap(options: {
  /**
   * How far a contact may travel and still count as a tap, in screen pixels.
   * This is the tools' click slop, *not* the wider multi-finger tap tolerance:
   * anything past it has already promoted the press into a drag — nudged the
   * selection, dragged a handle, duplicated under a sticky Alt — and a press
   * that changed the document must not also drill.
   */
  moveTolerance: () => number;
}): TouchDoubleTap {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pendingRef = useRef<PendingTap | null>(null);
  /** The last completed single tap, waiting for a partner. */
  const lastRef = useRef<SingleTap | null>(null);

  const reset = useCallback(() => {
    pendingRef.current = null;
    lastRef.current = null;
  }, []);

  const down = useCallback((pointerId: number, screen: Vec2, lone: boolean) => {
    if (!lone) {
      reset();
      return;
    }
    pendingRef.current = {
      pointerId,
      screen,
      startTime: performance.now(),
      moved: false,
    };
  }, [reset]);

  const move = useCallback((pointerId: number, screen: Vec2) => {
    const pending = pendingRef.current;
    if (!pending || pending.pointerId !== pointerId || pending.moved) return;
    if (travelExceeds(pending.screen, screen, optionsRef.current.moveTolerance()))
      pending.moved = true;
  }, []);

  const up = useCallback((pointerId: number, screen: Vec2) => {
    const pending = pendingRef.current;
    if (!pending || pending.pointerId !== pointerId) {
      lastRef.current = null;
      return false;
    }
    pendingRef.current = null;
    const time = performance.now();
    const clean =
      !pending.moved &&
      time - pending.startTime <= TAP_MAX_MS &&
      !travelExceeds(pending.screen, screen, optionsRef.current.moveTolerance());
    if (!clean) {
      lastRef.current = null;
      return false;
    }
    const tap: SingleTap = { screen, time };
    const prev = lastRef.current;
    // A fired double tap closes the run: a third tap starts a fresh pair
    // rather than drilling again on every extra tap.
    if (prev && isDoubleTap(prev, tap)) {
      lastRef.current = null;
      return true;
    }
    lastRef.current = tap;
    return false;
  }, []);

  return { down, move, up, reset };
}
