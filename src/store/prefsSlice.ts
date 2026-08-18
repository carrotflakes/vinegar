// Tool, viewport and persisted user preferences (colors, swatches, snapping).

import {
  isMarkerOrAbsent,
  isPaintOrNull,
  isStrokeDash,
} from "../io/serialize";
import { isMarkable } from "../model/marker";
import type { Paint } from "../model/paint";
import { solid } from "../model/paint";
import { isShape, selectionRoots } from "../model/scene";
import { shapePaintFields } from "../model/stroke";
import {
  STROKE_ALIGNMENTS,
  STROKE_CAPS,
  STROKE_JOINS,
  UNTITLED_DOCUMENT_NAME,
} from "../model/types";
import type { Document, Marker, Shape } from "../model/types";
import { initialViewport } from "@/model/geometry/viewport";
import { notify } from "./toastStore";
import {
  clearTransient,
  type EditorData,
  type PrefsActions,
  type StoreCtx,
  type StyleDefaults,
} from "./state";

const RECENT_COLORS_KEY = "vinegar.recentColors";
const RECENT_COLORS_MAX = 12;
const SAVED_SWATCHES_KEY = "vinegar.savedSwatches";
const SNAP_ENABLED_KEY = "vinegar.snapEnabled";
const GRID_SNAP_KEY = "vinegar.gridSnap";
const GRID_VISIBLE_KEY = "vinegar.gridVisible";
const GUIDE_SNAP_KEY = "vinegar.guideSnap";
const GUIDES_VISIBLE_KEY = "vinegar.guidesVisible";
const GUIDES_LOCKED_KEY = "vinegar.guidesLocked";
const RULERS_VISIBLE_KEY = "vinegar.rulersVisible";
const STYLE_KEY = "vinegar.style";

function loadColorList(key: string, max = Infinity): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(raw) ? raw.filter((c) => typeof c === "string").slice(0, max) : [];
  } catch { return []; }
}
function saveColorList(key: string, list: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage is optional */ }
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "true";
  } catch { return fallback; }
}
function saveBool(key: string, value: boolean): void {
  try { localStorage.setItem(key, String(value)); } catch { /* storage is optional */ }
}

type PrefsData = Pick<
  EditorData,
  | "tool" | "viewport" | "style"
  | "snapEnabled" | "gridSnap" | "gridVisible" | "gridSize"
  | "guideSnap" | "guidesVisible" | "guidesLocked" | "rulersVisible"
  | "recentColors" | "savedSwatches"
>;

/** The paint a fresh install draws with, before any of it is edited. */
function defaultStyle(): StyleDefaults {
  return {
    fill: solid("#4f8cff"),
    stroke: solid("#1b1b1b"),
    strokeWidth: 2,
    strokeDash: [],
    strokeDashOffset: 0,
    strokeCap: "round",
    strokeJoin: "round",
    strokeAlignment: "center",
    markerStart: null,
    markerEnd: null,
  };
}

function saveStyle(style: StyleDefaults): void {
  try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch { /* storage is optional */ }
}

/**
 * The persisted new-shape defaults. localStorage is untrusted input, so every
 * field is validated with the predicates the file format already uses and falls
 * back to its built-in default on its own — a stored style that has gone stale
 * costs one field, not the whole set.
 *
 * Pattern and swatch paints name something that lives inside a *document* (an
 * image asset, a global colour); the document open in the next session need not
 * have it, so they never survive a reload.
 */
function loadStyle(): StyleDefaults {
  const base = defaultStyle();
  let raw: unknown;
  try { raw = JSON.parse(localStorage.getItem(STYLE_KEY) || "null"); }
  catch { return base; }
  if (typeof raw !== "object" || raw === null) return base;
  const stored = raw as Record<string, unknown>;
  const num = (value: unknown, fallback: number, min = -Infinity) =>
    typeof value === "number" && Number.isFinite(value) && value >= min
      ? value
      : fallback;
  const paint = (value: unknown, fallback: Paint | null) => {
    if (!isPaintOrNull(value)) return fallback;
    const type = (value as Paint | null)?.type;
    return type === "pattern" || type === "swatch"
      ? fallback
      : (value as Paint | null);
  };
  const marker = (value: unknown, fallback: Marker | null) =>
    value === null ? null
      : value !== undefined && isMarkerOrAbsent(value) ? (value as Marker)
      : fallback;
  const oneOf = <T extends string>(
    values: readonly T[],
    value: unknown,
    fallback: T
  ) => (values.includes(value as T) ? (value as T) : fallback);
  return {
    fill: paint(stored.fill, base.fill),
    stroke: paint(stored.stroke, base.stroke),
    strokeWidth: num(stored.strokeWidth, base.strokeWidth, 0),
    strokeDash: isStrokeDash(stored.strokeDash)
      ? [...(stored.strokeDash as number[])]
      : base.strokeDash,
    strokeDashOffset: num(stored.strokeDashOffset, base.strokeDashOffset),
    strokeCap: oneOf(STROKE_CAPS, stored.strokeCap, base.strokeCap),
    strokeJoin: oneOf(STROKE_JOINS, stored.strokeJoin, base.strokeJoin),
    strokeAlignment: oneOf(
      STROKE_ALIGNMENTS,
      stored.strokeAlignment,
      base.strokeAlignment
    ),
    markerStart: marker(stored.markerStart, base.markerStart),
    markerEnd: marker(stored.markerEnd, base.markerEnd),
  };
}

/**
 * The shape "New shape defaults" copies from — the first selected one, the
 * same shape whose values the Appearance panel already shows. Images carry no
 * paint of their own, so they never qualify.
 */
export function styleSourceShape(
  doc: Document,
  selection: string[]
): Shape | null {
  const first = selectionRoots(doc, selection)[0];
  const node = first ? doc.nodes[first] : undefined;
  return isShape(node) && node.type !== "image" ? node : null;
}

export function initialPrefs(): PrefsData {
  return {
    tool: "select",
    viewport: initialViewport,
    style: loadStyle(),
    snapEnabled: loadBool(SNAP_ENABLED_KEY, true),
    gridSnap: loadBool(GRID_SNAP_KEY, false),
    gridVisible: loadBool(GRID_VISIBLE_KEY, true),
    gridSize: 50,
    guideSnap: loadBool(GUIDE_SNAP_KEY, true),
    guidesVisible: loadBool(GUIDES_VISIBLE_KEY, true),
    guidesLocked: loadBool(GUIDES_LOCKED_KEY, false),
    // On by default: the rulers are the only way to discover guides at all.
    rulersVisible: loadBool(RULERS_VISIBLE_KEY, true),
    recentColors: loadColorList(RECENT_COLORS_KEY, RECENT_COLORS_MAX),
    savedSwatches: loadColorList(SAVED_SWATCHES_KEY),
  };
}

export function createPrefsActions({ set, get, replaceDocumentWithoutHistory }: StoreCtx): PrefsActions {
  return {
    setTool: (tool) => set({ tool, selection: tool === "select" || tool === "node" ? get().selection : [], ...clearTransient }),
    setViewport: (viewport) => set({ viewport }),
    toggleSnap: () => { const snapEnabled = !get().snapEnabled; saveBool(SNAP_ENABLED_KEY, snapEnabled); set({ snapEnabled }); },
    toggleGridSnap: () => { const gridSnap = !get().gridSnap; saveBool(GRID_SNAP_KEY, gridSnap); set({ gridSnap }); },
    toggleGridVisible: () => { const gridVisible = !get().gridVisible; saveBool(GRID_VISIBLE_KEY, gridVisible); set({ gridVisible }); },
    toggleGuideSnap: () => { const guideSnap = !get().guideSnap; saveBool(GUIDE_SNAP_KEY, guideSnap); set({ guideSnap }); },
    // Hiding guides also drops the selection: an invisible selected guide would
    // still answer to Delete.
    toggleGuidesVisible: () => { const guidesVisible = !get().guidesVisible; saveBool(GUIDES_VISIBLE_KEY, guidesVisible); set({ guidesVisible, selectedGuideId: guidesVisible ? get().selectedGuideId : null }); },
    toggleGuidesLocked: () => { const guidesLocked = !get().guidesLocked; saveBool(GUIDES_LOCKED_KEY, guidesLocked); set({ guidesLocked, selectedGuideId: guidesLocked ? null : get().selectedGuideId }); },
    toggleRulers: () => { const rulersVisible = !get().rulersVisible; saveBool(RULERS_VISIBLE_KEY, rulersVisible); set({ rulersVisible }); },
    // The document grid travels with the file but is not an undoable edit.
    setGridSize: (size) => { const gridSize = Math.max(1, Math.round(size)); const doc = get().doc; replaceDocumentWithoutHistory({ ...doc, settings: { ...doc.settings, gridSize } }, { gridSize }); },
    // Like the grid size: travels with the file, but is not an undoable edit.
    // Blank input falls back to "Untitled" so save and export filenames always
    // have a stem to work from.
    setDocumentName: (name) => { const next = name.trim() || UNTITLED_DOCUMENT_NAME; const doc = get().doc; if (doc.metadata.name !== next) replaceDocumentWithoutHistory({ ...doc, metadata: { ...doc.metadata, name: next } }); },
    addRecentColor: (hex) => { const c = hex.toLowerCase(); const recentColors = [c, ...get().recentColors.filter((x) => x !== c)].slice(0, RECENT_COLORS_MAX); saveColorList(RECENT_COLORS_KEY, recentColors); set({ recentColors }); },
    addSwatch: (hex) => { const c = hex.toLowerCase(); if (get().savedSwatches.includes(c)) return; const savedSwatches = [...get().savedSwatches, c]; saveColorList(SAVED_SWATCHES_KEY, savedSwatches); set({ savedSwatches }); },
    removeSwatch: (hex) => { const savedSwatches = get().savedSwatches.filter((x) => x !== hex.toLowerCase()); saveColorList(SAVED_SWATCHES_KEY, savedSwatches); set({ savedSwatches }); },
    setStyle: (patch) => { const style = { ...get().style, ...patch }; saveStyle(style); set({ style }); },
    setStyleFromSelection: () => {
      const shape = styleSourceShape(get().doc, get().selection);
      if (!shape) return;
      const style: StyleDefaults = {
        ...get().style,
        ...shapePaintFields(shape),
        // A rect or a text node has no ends to mark, so it says nothing about
        // markers — clearing the arrowheads the user set up would be a loss.
        ...(isMarkable(shape)
          ? {
              markerStart: shape.markerStart ? { ...shape.markerStart } : null,
              markerEnd: shape.markerEnd ? { ...shape.markerEnd } : null,
            }
          : {}),
      };
      saveStyle(style);
      set({ style });
      // The defaults are only on screen with nothing selected, so the change is
      // invisible at the moment it happens.
      notify.info("New shape defaults updated");
    },
  };
}
