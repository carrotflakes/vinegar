import { useRef } from "react";

/** A pointer position plus the topmost element under it (via elementFromPoint),
 * from which a consumer reads its drop-zone data attributes. */
export interface DragPoint {
  x: number;
  y: number;
  target: Element | null;
}

export interface TouchDragOptions<T> {
  /** How long a touch must be held (roughly still) before a drag begins. Mouse
   * ignores this and starts on the first movement past `threshold`. */
  longPressMs?: number;
  /** Movement (px) that starts a mouse drag. */
  threshold?: number;
  /** Capture the pointer on the origin element once dragging, so elements the
   * pointer passes over (e.g. the canvas) don't receive stray pointer events.
   * Hit-testing still uses elementFromPoint, which capture doesn't affect. */
  capture?: boolean;
  /** Called once when the drag actually begins. */
  onStart?: (payload: T, p: DragPoint) => void;
  /** Called on every move while dragging. */
  onMove: (payload: T, p: DragPoint) => void;
  /** Released over a valid target. */
  onDrop: (payload: T, p: DragPoint) => void;
  /** Drag aborted (pointercancel, or a touch that scrolled away before the
   * long-press elapsed). Not called for a plain click that never dragged. */
  onCancel?: (payload: T) => void;
}

const MOUSE_THRESHOLD = 4;
// Fingers wobble; only cancel a pending long-press once it clearly pans away.
const TOUCH_TOLERANCE = 10;
const DEFAULT_LONG_PRESS = 250;

interface Active<T> {
  payload: T;
  pointerId: number;
  startX: number;
  startY: number;
  touch: boolean;
  dragging: boolean;
  timer: number | null;
  el: Element;
  captured: boolean;
}

function createHandler<T>(opts: { current: TouchDragOptions<T> }) {
  let active: Active<T> | null = null;

  const point = (e: PointerEvent): DragPoint => ({
    x: e.clientX,
    y: e.clientY,
    target: document.elementFromPoint(e.clientX, e.clientY),
  });

  // Swallow the click the browser synthesizes after a drag, so the tap that
  // ended a reorder doesn't also select/activate the drop target.
  const swallowClick = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    window.removeEventListener("click", swallowClick, true);
  };

  // Block native scrolling only while a touch drag is live; before that the list
  // stays free to pan, which is why draggable rows keep touch-action: auto.
  const blockScroll = (e: TouchEvent) => {
    if (active?.dragging) e.preventDefault();
  };

  const teardown = () => {
    if (!active) return;
    if (active.timer != null) clearTimeout(active.timer);
    if (active.captured) {
      try {
        active.el.releasePointerCapture(active.pointerId);
      } catch {
        // Pointer already gone; nothing to release.
      }
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("touchmove", blockScroll);
    active = null;
  };

  const begin = (p: DragPoint) => {
    if (!active || active.dragging) return;
    active.dragging = true;
    if (active.timer != null) {
      clearTimeout(active.timer);
      active.timer = null;
    }
    if (active.touch)
      window.addEventListener("touchmove", blockScroll, { passive: false });
    if (opts.current.capture) {
      try {
        active.el.setPointerCapture(active.pointerId);
        active.captured = true;
      } catch {
        // Pointer already released before the long-press elapsed.
      }
    }
    opts.current.onStart?.(active.payload, p);
  };

  function onMove(e: PointerEvent) {
    if (!active || e.pointerId !== active.pointerId) return;
    if (!active.dragging) {
      const dx = Math.abs(e.clientX - active.startX);
      const dy = Math.abs(e.clientY - active.startY);
      if (active.touch) {
        // Panning away before the long-press fires means the user meant to
        // scroll — release the gesture back to the browser.
        if (dx > TOUCH_TOLERANCE || dy > TOUCH_TOLERANCE) teardown();
        return;
      }
      const threshold = opts.current.threshold ?? MOUSE_THRESHOLD;
      if (dx < threshold && dy < threshold) return;
      begin(point(e));
    }
    opts.current.onMove(active.payload, point(e));
  }

  function onUp(e: PointerEvent) {
    if (!active || e.pointerId !== active.pointerId) return;
    const { payload, dragging } = active;
    const p = point(e);
    if (dragging) {
      window.addEventListener("click", swallowClick, true);
      // If no click follows (e.g. touch), stop swallowing a later real one.
      setTimeout(() => window.removeEventListener("click", swallowClick, true), 350);
    }
    teardown();
    if (dragging) opts.current.onDrop(payload, p);
  }

  function onPointerCancel(e: PointerEvent) {
    if (!active || e.pointerId !== active.pointerId) return;
    const { payload, dragging } = active;
    teardown();
    if (dragging) opts.current.onCancel?.(payload);
  }

  return (e: React.PointerEvent, payload: T) => {
    if (active) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const touch = e.pointerType !== "mouse";
    active = {
      payload,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      touch,
      dragging: false,
      timer: null,
      el: e.currentTarget as Element,
      captured: false,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onPointerCancel);
    if (touch) {
      const startX = e.clientX;
      const startY = e.clientY;
      active.timer = window.setTimeout(
        () => begin({ x: startX, y: startY, target: document.elementFromPoint(startX, startY) }),
        opts.current.longPressMs ?? DEFAULT_LONG_PRESS
      );
    }
  };
}

/**
 * Pointer-based dragging that works for mouse and touch alike, replacing HTML5
 * drag-and-drop (which never fires from touch). Mouse drags start on movement;
 * touch drags start on a long-press so a quick swipe still scrolls the list.
 *
 * Returns a `startDrag(event, payload)` to call from a draggable element's
 * `onPointerDown`. During the drag the callbacks receive that payload plus the
 * element under the pointer, so consumers hit-test drop zones by their own data
 * attributes rather than relying on per-element dragover handlers.
 */
export function useTouchDrag<T>(options: TouchDragOptions<T>) {
  // Latest callbacks, read live by the once-built stable handler below.
  const opts = useRef(options);
  opts.current = options;
  const handler = useRef<((e: React.PointerEvent, payload: T) => void) | null>(null);
  if (!handler.current) handler.current = createHandler(opts);
  return handler.current;
}
