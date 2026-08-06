import { create } from "zustand";

/**
 * Session state for the gradient tool: which of a shape's two paints it edits
 * and which stop is active. Kept out of the editor store because nothing here
 * is part of the document or worth persisting — it is the tool's own focus,
 * the way `penDraftStore` holds the pen's.
 */
interface GradientToolState {
  target: "fill" | "stroke";
  /** Id of the stop the annotator highlights; null selects the first one. */
  stopId: string | null;
  setTarget: (target: "fill" | "stroke") => void;
  setStopId: (id: string | null) => void;
}

export const useGradientTool = create<GradientToolState>((set) => ({
  target: "fill",
  stopId: null,
  setTarget: (target) => set({ target, stopId: null }),
  setStopId: (stopId) => set({ stopId }),
}));
