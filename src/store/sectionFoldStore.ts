import { create } from "zustand";

/**
 * Which panel sections the user has folded shut.
 *
 * Outside the panel components, for the reason `layersViewStore` gives: the
 * dock renders only the active tab, so a section's own state would be lost
 * every time the panel is unmounted by a tab switch or a dock move. Outside the
 * editor store too — it is view state and must never reach undo history.
 *
 * Keyed by the stable `id` a `Section` declares, not by its title, so a
 * renamed section keeps its fold and two panels can carry the same title.
 */
export interface SectionFoldState {
  collapsed: Set<string>;
  toggle: (id: string) => void;
  isCollapsed: (id: string) => boolean;
}

export const useSectionFold = create<SectionFoldState>((set, get) => ({
  collapsed: new Set(),
  toggle: (id) => {
    const next = new Set(get().collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ collapsed: next });
  },
  isCollapsed: (id) => get().collapsed.has(id),
}));
