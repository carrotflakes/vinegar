import { create } from "zustand";
import {
  defaultLayout,
  loadLayout,
  saveLayout,
  type DockLayout,
} from "./dockLayout";
import { PANEL_IDS } from "./panels";

type LayoutUpdater = DockLayout | ((layout: DockLayout) => DockLayout);

interface DockStore {
  layout: DockLayout;
  setLayout: (updater: LayoutUpdater) => void;
  /** Restore the built-in layout (used by the "reset layout" preference). */
  resetLayout: () => void;
}

/**
 * The dock layout lives in a store rather than in the `Dock` component so it can
 * be reset from elsewhere (Preferences). Every write is mirrored to localStorage.
 */
export const useDock = create<DockStore>((set, get) => ({
  layout: loadLayout(PANEL_IDS),
  setLayout: (updater) => {
    const layout =
      typeof updater === "function" ? updater(get().layout) : updater;
    saveLayout(layout);
    set({ layout });
  },
  resetLayout: () => {
    const layout = defaultLayout();
    saveLayout(layout);
    set({ layout });
  },
}));
