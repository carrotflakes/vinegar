import { create } from "zustand";
import {
  defaultLayout,
  loadLayout,
  saveLayout,
  type DockLayout,
} from "./dockLayout";
import { PANEL_IDS } from "./panels";

type LayoutUpdater = DockLayout | ((layout: DockLayout) => DockLayout);

const WIDTH_KEY = "vinegar.dockWidth";
export const DEFAULT_DOCK_WIDTH = 258;
const MIN_DOCK_WIDTH = 200;
const MAX_DOCK_WIDTH = 560;

export function clampDockWidth(w: number): number {
  return Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, w));
}

function loadWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampDockWidth(raw) : DEFAULT_DOCK_WIDTH;
}

interface DockStore {
  layout: DockLayout;
  /** Sidebar width in px; resized by dragging the sidebar's left edge. */
  width: number;
  setLayout: (updater: LayoutUpdater) => void;
  setWidth: (width: number) => void;
  /** Restore the built-in layout and width (used by the "reset layout" preference). */
  resetLayout: () => void;
}

/**
 * The dock's layout and width live in a store rather than in the components so
 * they can be reset from elsewhere (Preferences). Every write is mirrored to
 * localStorage.
 */
export const useDock = create<DockStore>((set, get) => ({
  layout: loadLayout(PANEL_IDS),
  width: loadWidth(),
  setLayout: (updater) => {
    const layout =
      typeof updater === "function" ? updater(get().layout) : updater;
    saveLayout(layout);
    set({ layout });
  },
  setWidth: (width) => {
    const w = clampDockWidth(width);
    localStorage.setItem(WIDTH_KEY, String(w));
    set({ width: w });
  },
  resetLayout: () => {
    const layout = defaultLayout();
    saveLayout(layout);
    localStorage.setItem(WIDTH_KEY, String(DEFAULT_DOCK_WIDTH));
    set({ layout, width: DEFAULT_DOCK_WIDTH });
  },
}));
