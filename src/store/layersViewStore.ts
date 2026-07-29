import { create } from "zustand";

/**
 * Which containers are folded shut in the Layers panel.
 *
 * Deliberately outside the panel component: the dock renders only the active
 * tab, so switching tabs (or moving the panel between dock groups) unmounts
 * LayersPanel — component state would drop every fold the user had set up.
 * Deliberately outside the editor store too: it is view state, carries no
 * document data and must never reach history.
 *
 * Ids of deleted nodes may linger in the set; they simply never match a row,
 * and pruning them would mean watching the document for no visible gain.
 */
export interface LayersViewState {
  collapsed: Set<string>;
  toggleCollapsed: (id: string) => void;
  /** Unfold containers, e.g. to reveal a row selected elsewhere. */
  expand: (ids: string[]) => void;
}

export const useLayersView = create<LayersViewState>((set, get) => ({
  collapsed: new Set(),
  toggleCollapsed: (id) => {
    const next = new Set(get().collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ collapsed: next });
  },
  expand: (ids) => {
    const prev = get().collapsed;
    if (!ids.some((id) => prev.has(id))) return;
    const next = new Set(prev);
    for (const id of ids) next.delete(id);
    set({ collapsed: next });
  },
}));
