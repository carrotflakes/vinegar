// Persistent ruler guides (doc.guides). Guides are not scene nodes: they carry
// no transform or appearance and never enter `selection` — the one selected
// guide lives in `selectedGuideId`. Every mutation here is an ordinary undoable
// document edit. See docs/rulers-and-guides.md.

import { makeId, type Document, type GuideLine } from "../model/types";
import type { GuideActions, StoreCtx } from "./state";

export function createGuideActions({ set, get, transact }: StoreCtx): GuideActions {
  // Guide edits during a pointer drag join that drag's single undo step; a
  // standalone edit (menu, keyboard) is a step of its own.
  const commit = (next: Document, label: string) => {
    const state = get();
    if (state._interaction) state.setDoc(next);
    else transact(next, { label });
  };

  return {
    setSelectedGuide: (id) => set({ selectedGuideId: id }),

    addGuide: (axis, position) => {
      const doc = get().doc;
      const guide: GuideLine = { id: makeId("guide"), axis, position };
      commit({ ...doc, guides: [...doc.guides, guide] }, "Add guide");
      set({ selectedGuideId: guide.id });
      return guide.id;
    },

    moveGuide: (id, position) => {
      const doc = get().doc;
      if (!doc.guides.some((g) => g.id === id)) return;
      commit(
        { ...doc, guides: doc.guides.map((g) => (g.id === id ? { ...g, position } : g)) },
        "Move guide"
      );
    },

    removeGuide: (id) => {
      const doc = get().doc;
      if (!doc.guides.some((g) => g.id === id)) return;
      commit({ ...doc, guides: doc.guides.filter((g) => g.id !== id) }, "Delete guide");
      if (get().selectedGuideId === id) set({ selectedGuideId: null });
    },

    clearGuides: () => {
      const doc = get().doc;
      if (doc.guides.length === 0) return;
      commit({ ...doc, guides: [] }, "Clear guides");
      set({ selectedGuideId: null });
    },
  };
}
