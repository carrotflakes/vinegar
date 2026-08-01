import { create } from "zustand";

// ===========================================================================
// The pen's draft itself lives in a canvas ref (see ToolContext.penDraft) so
// that placing anchors never re-renders React. Its *existence* still has to
// drive DOM chrome — the on-screen finish/cancel bar, which is the only way to
// end a path without a keyboard. This store mirrors just that much: how many
// anchors the draft holds, 0 when there is none.
// ===========================================================================

interface PenDraftState {
  anchors: number;
  setAnchors: (anchors: number) => void;
}

export const usePenDraftInfo = create<PenDraftState>((set) => ({
  anchors: 0,
  // Returning the same state object is zustand's no-op, so the many
  // same-count writes a drag makes never wake a subscriber.
  setAnchors: (anchors) => set((s) => (s.anchors === anchors ? s : { anchors })),
}));
