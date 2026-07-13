// Tool, viewport and persisted user preferences (colors, swatches, snapping).

import { solid } from "../model/paint";
import { initialViewport } from "../model/viewport";
import {
  clearTransient,
  type EditorData,
  type PrefsActions,
  type StoreCtx,
} from "./state";

const RECENT_COLORS_KEY = "vinegar.recentColors";
const RECENT_COLORS_MAX = 12;
const SAVED_SWATCHES_KEY = "vinegar.savedSwatches";

function loadColorList(key: string, max = Infinity): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(raw) ? raw.filter((c) => typeof c === "string").slice(0, max) : [];
  } catch { return []; }
}
function saveColorList(key: string, list: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage is optional */ }
}

type PrefsData = Pick<
  EditorData,
  | "tool" | "viewport" | "style"
  | "snapEnabled" | "gridSnap" | "gridSize"
  | "recentColors" | "savedSwatches"
>;

export function initialPrefs(): PrefsData {
  return {
    tool: "select",
    viewport: initialViewport,
    style: {
      fill: solid("#4f8cff"),
      stroke: solid("#1b1b1b"),
      strokeWidth: 2,
      strokeDash: [],
      strokeDashOffset: 0,
      strokeCap: "round",
      strokeJoin: "round",
      strokeAlignment: "center",
    },
    snapEnabled: true,
    gridSnap: false,
    gridSize: 50,
    recentColors: loadColorList(RECENT_COLORS_KEY, RECENT_COLORS_MAX),
    savedSwatches: loadColorList(SAVED_SWATCHES_KEY),
  };
}

export function createPrefsActions({ set, get }: StoreCtx): PrefsActions {
  return {
    setTool: (tool) => set({ tool, selection: tool === "select" || tool === "node" ? get().selection : [], ...(tool === "select" || tool === "node" ? {} : clearTransient), editNode: null }),
    setViewport: (viewport) => set({ viewport }),
    toggleSnap: () => set({ snapEnabled: !get().snapEnabled }),
    toggleGridSnap: () => set({ gridSnap: !get().gridSnap }),
    // The document grid travels with the file but is not an undoable edit.
    setGridSize: (size) => { const gridSize = Math.max(1, Math.round(size)); const doc = get().doc; set({ gridSize, doc: { ...doc, settings: { ...doc.settings, gridSize } } }); },
    addRecentColor: (hex) => { const c = hex.toLowerCase(); const recentColors = [c, ...get().recentColors.filter((x) => x !== c)].slice(0, RECENT_COLORS_MAX); saveColorList(RECENT_COLORS_KEY, recentColors); set({ recentColors }); },
    addSwatch: (hex) => { const c = hex.toLowerCase(); if (get().savedSwatches.includes(c)) return; const savedSwatches = [...get().savedSwatches, c]; saveColorList(SAVED_SWATCHES_KEY, savedSwatches); set({ savedSwatches }); },
    removeSwatch: (hex) => { const savedSwatches = get().savedSwatches.filter((x) => x !== hex.toLowerCase()); saveColorList(SAVED_SWATCHES_KEY, savedSwatches); set({ savedSwatches }); },
    setStyle: (patch) => set({ style: { ...get().style, ...patch } }),
  };
}
