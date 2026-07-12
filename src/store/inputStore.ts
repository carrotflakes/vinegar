import { create } from "zustand";

// ===========================================================================
// Input / modifier layer. Tool behaviour is driven by Shift (constrain) and
// Alt (from-center / break-symmetry). On a keyboard those come from the event;
// on touch there are no modifier keys, so this store also holds "sticky"
// on-screen toggles. Read the effective modifier state through `readModifiers`
// so a single path serves both physical keys and the on-screen toggles.
// ===========================================================================

interface InputState {
  /** Sticky on-screen toggles (persist until tapped off). */
  stickyShift: boolean;
  stickyAlt: boolean;
  /** Physical key state, mirrored for UI display. */
  physShift: boolean;
  physAlt: boolean;
  toggleStickyShift: () => void;
  toggleStickyAlt: () => void;
  clearSticky: () => void;
  setPhysical: (m: { shift?: boolean; alt?: boolean }) => void;
}

export const useInput = create<InputState>((set) => ({
  stickyShift: false,
  stickyAlt: false,
  physShift: false,
  physAlt: false,
  toggleStickyShift: () => set((s) => ({ stickyShift: !s.stickyShift })),
  toggleStickyAlt: () => set((s) => ({ stickyAlt: !s.stickyAlt })),
  clearSticky: () => set({ stickyShift: false, stickyAlt: false }),
  setPhysical: (m) =>
    set((s) => ({
      physShift: m.shift ?? s.physShift,
      physAlt: m.alt ?? s.physAlt,
    })),
}));

/**
 * Effective modifiers for an event: the event's own keys OR the sticky
 * on-screen toggles. Use at every pointer/keyboard read so tools honour both.
 */
export function readModifiers(e: {
  shiftKey: boolean;
  altKey: boolean;
}): { shift: boolean; alt: boolean } {
  const s = useInput.getState();
  return {
    shift: e.shiftKey || s.stickyShift,
    alt: e.altKey || s.stickyAlt,
  };
}

/** Whether Shift is currently active from any source (keys or sticky). */
export function shiftActive(): boolean {
  const s = useInput.getState();
  return s.physShift || s.stickyShift;
}

/** Whether Alt is currently active from any source (keys or sticky). */
export function altActive(): boolean {
  const s = useInput.getState();
  return s.physAlt || s.stickyAlt;
}
