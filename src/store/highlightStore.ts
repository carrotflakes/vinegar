import { create } from "zustand";

/**
 * The node the pointer is hovering in a panel (Layers today), outlined on the
 * canvas so the row and the artwork can be matched up without selecting.
 *
 * Deliberately outside the editor store: it changes on every pointer move over
 * the list, carries no document state and must never reach history.
 */
export interface HighlightState {
  nodeId: string | null;
  /** When the current highlight began, driving its entry pulse. */
  at: number;
  setHighlight: (nodeId: string | null) => void;
  clearHighlight: (nodeId: string) => void;
}

const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export const useHighlight = create<HighlightState>((set, get) => ({
  nodeId: null,
  at: 0,
  setHighlight: (nodeId) => {
    if (get().nodeId !== nodeId) set({ nodeId, at: now() });
  },
  // Leaving a row only clears the highlight if it is still that row's: pointer
  // enter of the next row can arrive before the previous one's leave.
  clearHighlight: (nodeId) => {
    if (get().nodeId === nodeId) set({ nodeId: null });
  },
}));
