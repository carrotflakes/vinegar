/**
 * Where a fresh pointer contact goes — the policy half of the canvas pointer
 * handling, kept free of refs, events and React so it can be reasoned about
 * and tested on its own. `usePointerHandlers` does the mechanics (capture,
 * bookkeeping, dispatch) and asks these functions what a contact means.
 *
 * See docs/pen-and-touch.md for the behaviour these rules encode.
 */

/**
 * How long touch stays suppressed after the pen leaves the glass. A palm lifts
 * a moment after the pen tip does, and the contact it leaves behind would
 * otherwise pan the canvas out from under the stroke that just ended.
 */
export const PEN_COOLDOWN_MS = 300;

/** Tools whose drag paints; these are the ones a finger may be kept out of. */
export const DRAWING_TOOLS = new Set(["brush", "pencil", "eraser"]);

/** A multi-touch tap must lift within this long to count as a tap. */
export const TAP_MAX_MS = 300;
/** Any contact travelling further than this makes it a drag, not a tap. */
export const TAP_TOLERANCE = 16;

export type ContactRoute =
  /** A hand resting while the pen works: drop it, and any tap it was part of. */
  | "reject-palm"
  /** Held back by the pen cooldown, but still eligible to complete a tap. */
  | "reject-cooldown"
  /** Promote to a two-finger pinch/twist/pan gesture. */
  | "gesture"
  /** Navigate instead of drawing (finger drawing is off). */
  | "pan"
  /** Hand it to the active tool. */
  | "tool";

export interface ContactContext {
  /** `PointerEvent.pointerType` of the contact going down. */
  pointerType: string;
  /** A pen is on the glass right now. */
  penDown: boolean;
  /** Milliseconds since the pen last reported anything; `Infinity` if never. */
  sincePen: number;
  /** Touch contacts already down, not counting this one. */
  liveTouches: number;
  /** The active tool id. */
  tool: string;
  /** The `canvas.fingerDrawing` preference. */
  fingerDrawing: boolean;
}

/**
 * Decide what a contact landing on the canvas means. Pen and mouse always go
 * straight to the tool; only touch is filtered, promoted or rerouted.
 */
export function routeContact(contact: ContactContext): ContactRoute {
  const { pointerType, penDown, sincePen, liveTouches, tool } = contact;
  if (pointerType !== "touch") return "tool";
  // Palm rejection. While the pen is down every contact is hand; for a moment
  // after it lifts a contact is probably the palm following it off the glass.
  if (penDown) return "reject-palm";
  if (sincePen < PEN_COOLDOWN_MS) return "reject-cooldown";
  // A second finger is always a gesture — including on top of a finger-drawn
  // stroke, which is how a touch-only user pinches out of the brush tool.
  if (liveTouches >= 1) return "gesture";
  if (DRAWING_TOOLS.has(tool) && !contact.fingerDrawing) return "pan";
  return "tool";
}

export interface TapRunSummary {
  /** How many contacts were down at once — the tap's "arity". */
  maxPointers: number;
  /** How long the whole run took, first contact down to last one up. */
  elapsedMs: number;
  /** Whether any contact travelled past `TAP_TOLERANCE`. */
  moved: boolean;
}

/** What a finished multi-touch run means: two fingers undo, three redo. */
export function judgeTap(run: TapRunSummary): "undo" | "redo" | null {
  if (run.moved || run.elapsedMs > TAP_MAX_MS) return null;
  if (run.maxPointers === 2) return "undo";
  if (run.maxPointers === 3) return "redo";
  return null;
}

/** How long a second finger tap may wait before it stops being a double tap. */
export const DOUBLE_TAP_MAX_GAP_MS = 300;
/** How far apart the two taps of a double tap may land. Wider than
 *  `TAP_TOLERANCE`: a finger is blunt, and the second tap is aimed by memory. */
export const DOUBLE_TAP_TOLERANCE = 24;

export interface SingleTap {
  /** Where the contact landed. */
  screen: { x: number; y: number };
  /** When it lifted. */
  time: number;
}

/**
 * Whether `next` completes a double tap started by `prev` — the touch stand-in
 * for a mouse double-click. Both taps must already qualify as single taps
 * (lone finger, short, still); this only judges the pair.
 */
export function isDoubleTap(prev: SingleTap, next: SingleTap): boolean {
  if (next.time - prev.time > DOUBLE_TAP_MAX_GAP_MS) return false;
  return (
    Math.hypot(next.screen.x - prev.screen.x, next.screen.y - prev.screen.y) <=
    DOUBLE_TAP_TOLERANCE
  );
}

/** Whether a contact has strayed further than `tolerance` from where it landed. */
export function travelExceeds(
  from: { x: number; y: number },
  to: { x: number; y: number },
  tolerance: number
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > tolerance;
}

/** Whether a contact has strayed far enough to stop being part of a tap. */
export function exceedsTapTolerance(
  from: { x: number; y: number },
  to: { x: number; y: number }
): boolean {
  return travelExceeds(from, to, TAP_TOLERANCE);
}
