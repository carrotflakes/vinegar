// ===========================================================================
// Command registry — the single source of truth for user-invocable actions.
//
// Every action a user can trigger (via keyboard, context menu, File menu or
// the command palette) is declared once here as a Command: an id, a label, an
// optional keyboard shortcut, an `enabled` predicate and a `run` body. The
// surfaces (App keydown handler, ui/menus.ts, ui/FileMenu.tsx, the palette)
// derive their behaviour from this list rather than re-wiring each action, so
// labels, shortcut hints and enabled/disabled state stay in sync automatically
// and new UI (command palette, on-screen action bars, custom keymaps) can be
// built on top without touching the actions themselves.
// ===========================================================================

import {
  canReleaseCompoundPathSelection,
  canMakeCompoundPathSelection,
} from "../model/compoundPath";
import { createDemoDocument } from "../demo/createDemoDocument";
import { canGroupSelection, selectionUnits } from "../model/groups";
import { isInstance, parentIdOf, selectionRoots } from "../model/scene";
import type { Vec2 } from "../model/types";
import { initialViewport, zoomAt } from "../model/viewport";
import { downloadBlob, downloadText, pickTextFile } from "../io/download";
import { exportPng } from "../io/exportPng";
import { exportSvg } from "../io/exportSvg";
import { parseDocument, serializeDocument } from "../io/serialize";
import { useEditor } from "../store/editorStore";
import type { EditorState } from "../store/state";
import { toggleFullscreen } from "../ui/fullscreen";

// --- Platform-aware modifier labels --------------------------------------

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
/** Display label for the primary modifier (Cmd on macOS, Ctrl elsewhere). */
export const MOD = isMac ? "⌘" : "Ctrl";

// --- Shortcut model ------------------------------------------------------

/** A single key chord. `mod` means Ctrl (or Cmd on macOS). */
export interface KeyStroke {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Runtime context a command may need (e.g. the point a menu opened at). */
export interface CommandContext {
  at?: Vec2;
}

export interface Command {
  id: string;
  label: string;
  /** Palette grouping / section. */
  group: string;
  /** Trigger chords. The first is used for display. */
  keys?: KeyStroke[];
  /** Whether the command currently applies. Defaults to always-enabled. */
  enabled?: (s: EditorState) => boolean;
  run: (s: EditorState, ctx?: CommandContext) => void | Promise<void>;
  /** Destructive action (styled accordingly in menus). */
  danger?: boolean;
  /** Hide from the command palette (still keyboard/menu invocable). */
  hidden?: boolean;
}

// --- Selection-derived enablement ----------------------------------------

/** Booleans about the current selection used by several command predicates. */
function sel(s: EditorState) {
  const roots = selectionRoots(s.doc, s.selection);
  const parents = new Set(roots.map((id) => parentIdOf(s.doc, id)));
  const instanceRoots = roots.filter((id) => isInstance(s.doc.nodes[id]));
  const singleInstanceNode =
    roots.length === 1 && isInstance(s.doc.nodes[roots[0]])
      ? s.doc.nodes[roots[0]]
      : null;
  return {
    hasSelection: s.selection.length > 0,
    canGroup: canGroupSelection(s.doc, s.selection),
    canUngroup: selectionUnits(s.doc, s.selection).groups.length > 0,
    canMakeCompound: canMakeCompoundPathSelection(s.doc, s.selection),
    canReleaseCompound: canReleaseCompoundPathSelection(s.doc, s.selection),
    canMakeSymbol: roots.length >= 1 && parents.size === 1,
    hasInstances: instanceRoots.length > 0,
    singleInstance:
      singleInstanceNode && isInstance(singleInstanceNode)
        ? singleInstanceNode
        : null,
  };
}

/** Center of the canvas viewport in screen coords (for zoom-to-center). */
export function canvasCenter(): Vec2 {
  const el = document.querySelector(".canvas-wrap");
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.width / 2, y: r.height / 2 };
}

// --- The commands --------------------------------------------------------

export const COMMANDS: Command[] = [
  // History -----------------------------------------------------------------
  {
    id: "edit.undo",
    label: "Undo",
    group: "Edit",
    keys: [{ key: "z", mod: true }],
    enabled: (s) => s.history.past.length > 0,
    run: (s) => s.undo(),
  },
  {
    id: "edit.redo",
    label: "Redo",
    group: "Edit",
    keys: [
      { key: "z", mod: true, shift: true },
      { key: "y", mod: true },
    ],
    enabled: (s) => s.history.future.length > 0,
    run: (s) => s.redo(),
  },

  // Clipboard ---------------------------------------------------------------
  {
    id: "edit.cut",
    label: "Cut",
    group: "Edit",
    keys: [{ key: "x", mod: true }],
    enabled: (s) => sel(s).hasSelection,
    run: (s) => s.cutSelected(),
  },
  {
    id: "edit.copy",
    label: "Copy",
    group: "Edit",
    keys: [{ key: "c", mod: true }],
    enabled: (s) => sel(s).hasSelection,
    run: (s) => s.copySelected(),
  },
  {
    id: "edit.paste",
    label: "Paste",
    group: "Edit",
    keys: [{ key: "v", mod: true }],
    enabled: (s) => s.clipboard != null,
    run: (s, ctx) => s.paste(ctx?.at),
  },
  {
    id: "edit.duplicate",
    label: "Duplicate",
    group: "Edit",
    keys: [{ key: "d", mod: true }],
    enabled: (s) => sel(s).hasSelection,
    run: (s) => s.duplicateSelected(),
  },

  // Selection ---------------------------------------------------------------
  {
    id: "select.all",
    label: "Select all",
    group: "Selection",
    keys: [{ key: "a", mod: true }],
    run: (s) => s.selectAll(),
  },
  {
    id: "edit.delete",
    label: "Delete",
    group: "Edit",
    danger: true,
    keys: [{ key: "Delete" }, { key: "Backspace" }],
    enabled: (s) => s.editNode != null || s.selection.length > 0,
    run: (s) => {
      if (s.editNode) s.deleteEditNode();
      else s.deleteSelected();
    },
  },

  // Structure ---------------------------------------------------------------
  {
    id: "structure.group",
    label: "Group",
    group: "Arrange",
    keys: [{ key: "g", mod: true }],
    enabled: (s) => sel(s).canGroup,
    run: (s) => s.groupSelected(),
  },
  {
    id: "structure.ungroup",
    label: "Ungroup",
    group: "Arrange",
    keys: [{ key: "g", mod: true, shift: true }],
    enabled: (s) => sel(s).canUngroup,
    run: (s) => s.ungroupSelected(),
  },
  {
    id: "structure.makeCompound",
    label: "Make compound path",
    group: "Arrange",
    keys: [{ key: "8", mod: true }],
    enabled: (s) => sel(s).canMakeCompound,
    run: (s) => s.makeCompoundPathSelected(),
  },
  {
    id: "structure.releaseCompound",
    label: "Release compound path",
    group: "Arrange",
    keys: [{ key: "8", mod: true, alt: true }],
    enabled: (s) => sel(s).canReleaseCompound,
    run: (s) => s.releaseCompoundPathSelected(),
  },
  {
    id: "structure.bringToFront",
    label: "Bring to front",
    group: "Arrange",
    enabled: (s) => sel(s).hasSelection,
    run: (s) => s.bringToFront(),
  },
  {
    id: "structure.sendToBack",
    label: "Send to back",
    group: "Arrange",
    enabled: (s) => sel(s).hasSelection,
    run: (s) => s.sendToBack(),
  },

  // Symbols -----------------------------------------------------------------
  {
    id: "symbol.create",
    label: "Create symbol",
    group: "Symbol",
    enabled: (s) => sel(s).canMakeSymbol,
    run: (s) => s.createSymbolFromSelection(),
  },
  {
    id: "symbol.editSelected",
    label: "Edit symbol",
    group: "Symbol",
    enabled: (s) => sel(s).singleInstance != null,
    run: (s) => {
      const inst = sel(s).singleInstance;
      if (inst) s.enterSymbolEdit(inst.symbolId);
    },
  },
  {
    id: "symbol.detach",
    label: "Detach instance",
    group: "Symbol",
    enabled: (s) => sel(s).hasInstances,
    run: (s) => s.detachSelectedInstances(),
  },

  // Tools -------------------------------------------------------------------
  { id: "tool.select", label: "Select tool", group: "Tools", keys: [{ key: "v" }], run: (s) => s.setTool("select") },
  { id: "tool.node", label: "Edit Nodes tool", group: "Tools", keys: [{ key: "n" }], run: (s) => s.setTool("node") },
  { id: "tool.rect", label: "Rectangle tool", group: "Tools", keys: [{ key: "r" }], run: (s) => s.setTool("rect") },
  { id: "tool.ellipse", label: "Ellipse tool", group: "Tools", keys: [{ key: "o" }], run: (s) => s.setTool("ellipse") },
  { id: "tool.line", label: "Line tool", group: "Tools", keys: [{ key: "l" }], run: (s) => s.setTool("line") },
  { id: "tool.pen", label: "Pen tool", group: "Tools", keys: [{ key: "p" }], run: (s) => s.setTool("pen") },
  { id: "tool.pencil", label: "Pencil tool", group: "Tools", keys: [{ key: "b" }], run: (s) => s.setTool("pencil") },

  // View --------------------------------------------------------------------
  {
    id: "view.zoomIn",
    label: "Zoom in",
    group: "View",
    run: (s) => s.setViewport(zoomAt(s.viewport, canvasCenter(), 1.2)),
  },
  {
    id: "view.zoomOut",
    label: "Zoom out",
    group: "View",
    run: (s) => s.setViewport(zoomAt(s.viewport, canvasCenter(), 1 / 1.2)),
  },
  {
    id: "view.reset",
    label: "Reset view",
    group: "View",
    run: (s) => s.setViewport(initialViewport),
  },
  {
    id: "view.toggleSnap",
    label: "Toggle snapping",
    group: "View",
    run: (s) => s.toggleSnap(),
  },
  {
    id: "view.toggleGrid",
    label: "Toggle grid snapping",
    group: "View",
    run: (s) => s.toggleGridSnap(),
  },
  {
    id: "view.fullscreen",
    label: "Toggle fullscreen",
    group: "View",
    run: () => toggleFullscreen(),
  },

  // File --------------------------------------------------------------------
  {
    id: "file.new",
    label: "New",
    group: "File",
    run: (s) => {
      if (
        s.doc.rootIds.length > 0 &&
        !window.confirm("Discard the current drawing and start a new one?")
      ) {
        return;
      }
      s.newDocument();
    },
  },
  {
    id: "file.open",
    label: "Open…",
    group: "File",
    run: async (s) => {
      const text = await pickTextFile(".json,application/json");
      if (text == null) return;
      try {
        s.loadDocument(parseDocument(text));
      } catch (err) {
        window.alert(
          "Could not open file:\n" +
            (err instanceof Error ? err.message : String(err))
        );
      }
    },
  },
  {
    id: "file.save",
    label: "Save (.json)",
    group: "File",
    run: (s) => {
      const json = serializeDocument(s.doc);
      downloadText(json, "drawing.vinegar.json", "application/json");
    },
  },
  {
    id: "file.exportPng",
    label: "Export PNG",
    group: "File",
    run: async (s) => {
      try {
        const blob = await exportPng(s.doc, { scale: 2 });
        downloadBlob(blob, "drawing.png");
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    id: "file.exportSvg",
    label: "Export SVG",
    group: "File",
    run: (s) => {
      try {
        const svg = exportSvg(s.doc);
        downloadText(svg, "drawing.svg", "image/svg+xml");
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    id: "file.demo",
    label: "Open demo",
    group: "File",
    run: (s) => {
      if (
        s.doc.rootIds.length > 0 &&
        !window.confirm("Discard the current drawing and open the demo?")
      ) {
        return;
      }
      s.loadDocument(createDemoDocument());
      s.setViewport({ scale: 0.85, offset: { x: 12, y: 12 } });
    },
  },
];

// --- Lookup & invocation -------------------------------------------------

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export function getCommand(id: string): Command | undefined {
  return BY_ID.get(id);
}

/** Whether a command is currently enabled against the live store state. */
export function commandEnabled(cmd: Command, s = useEditor.getState()): boolean {
  return cmd.enabled ? cmd.enabled(s) : true;
}

/** Run a command by id if it is currently enabled. */
export function runCommand(id: string, ctx?: CommandContext): void {
  const cmd = BY_ID.get(id);
  if (!cmd) return;
  const s = useEditor.getState();
  if (commandEnabled(cmd, s)) void cmd.run(s, ctx);
}

// --- Keyboard matching ---------------------------------------------------

function strokeMatches(k: KeyStroke, e: KeyboardEvent): boolean {
  const evKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const want = k.key.length === 1 ? k.key.toLowerCase() : k.key;
  if (evKey !== want) return false;
  if (!!k.mod !== (e.ctrlKey || e.metaKey)) return false;
  if (!!k.shift !== e.shiftKey) return false;
  if (!!k.alt !== e.altKey) return false;
  return true;
}

/** Find the command bound to a keydown event (regardless of enabled state). */
export function matchKeydown(
  e: KeyboardEvent
): { cmd: Command; stroke: KeyStroke } | null {
  for (const cmd of COMMANDS) {
    if (!cmd.keys) continue;
    for (const stroke of cmd.keys) {
      if (strokeMatches(stroke, e)) return { cmd, stroke };
    }
  }
  return null;
}

// --- Display -------------------------------------------------------------

function displayKey(key: string): string {
  if (key === "Delete" || key === "Backspace") return "Del";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Human-readable label for a chord, e.g. "⌘+Shift+G". */
export function formatKeys(k: KeyStroke): string {
  const parts: string[] = [];
  if (k.mod) parts.push(MOD);
  if (k.alt) parts.push(isMac ? "⌥" : "Alt");
  if (k.shift) parts.push(isMac ? "⇧" : "Shift");
  parts.push(displayKey(k.key));
  return parts.join("+");
}

/** Shortcut hint for a command (its first chord), or "" if none. */
export function commandShortcut(cmd: Command): string {
  return cmd.keys && cmd.keys.length > 0 ? formatKeys(cmd.keys[0]) : "";
}
