// ===========================================================================
// Command registry — the single source of truth for user-invocable actions.
//
// Every action a user can trigger (via keyboard, context menu, File menu or
// the command palette) is declared once as a Command. Editing commands live
// here; view and file commands are composed below from focused modules. The
// surfaces (App keydown handler, menus and the palette) derive their behaviour
// from the combined list, so labels, shortcuts and enabled state stay in sync.
// ===========================================================================

import {
  canReleaseCompoundPathSelection,
  canMakeCompoundPathSelection,
} from "@/model/path/compoundPath";
import { canConvertShapeToPath } from "@/model/path/convertToPath";
import {
  canMakeClippingMaskSelection,
  canReleaseClippingMaskSelection,
} from "../model/clippingMask";
import { canGroupSelection, selectionUnits } from "../model/groups";
import { isAreal } from "@/model/path/boolean";
import { joinableSubpathCount } from "@/model/path/joinPath";
import { canCombineSelection } from "@/model/path/combinePaths";
import { canSplitSubpaths } from "@/model/path/splitSubpaths";
import { hasCuttableNodes } from "@/model/path/cutPath";
import {
  childIdsOf,
  isGroup,
  isFrame,
  isInstance,
  isNodeHidden,
  isNodeLocked,
  isShape,
  parentIdOf,
  selectionRoots,
} from "../model/scene";
import { screenToWorld } from "@/model/geometry/viewport";
import { currentFocusRoot, useEditor } from "../store/editorStore";
import { groupEditNodesByShape } from "../store/state";
import type { EditorState } from "../store/state";
import {
  canvasCenter,
  pasteForeignPayload,
  placeImagesFitted,
  placeSvgFitted,
} from "./canvasPlacement";
import { FILE_COMMANDS } from "./fileCommands";
import type { Command, CommandContext, KeyStroke } from "./types";
import { VIEW_COMMANDS } from "./viewCommands";

export {
  canvasCenter,
  pasteForeignPayload,
  placeImagesFitted,
  placeSvgFitted,
};
export type { Command, CommandContext, KeyStroke } from "./types";

// --- Platform-aware modifier labels --------------------------------------

/** macOS, where Ctrl+click is a secondary click and Cmd is the toggle modifier. */
export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
/** Display label for the primary modifier (Cmd on macOS, Ctrl elsewhere). */
export const MOD = isMac ? "⌘" : "Ctrl";

// --- Selection-derived enablement ----------------------------------------

/** Booleans about the current selection used by several command predicates. */
function sel(s: EditorState) {
  const roots = selectionRoots(s.doc, s.selection);
  const parents = new Set(roots.map((id) => parentIdOf(s.doc, id)));
  const shapeRoots = roots.map((id) => s.doc.nodes[id]).filter(isShape);
  const instanceRoots = roots.filter((id) => isInstance(s.doc.nodes[id]));
  const singleInstanceNode =
    roots.length === 1 && isInstance(s.doc.nodes[roots[0]])
      ? s.doc.nodes[roots[0]]
      : null;
  return {
    hasSelection: s.selection.length > 0,
    canGroup: canGroupSelection(s.doc, s.selection),
    canUngroup: selectionUnits(s.doc, s.selection).groups.length > 0,
    canMakeClippingMask: canMakeClippingMaskSelection(s.doc, s.selection),
    canReleaseClippingMask: canReleaseClippingMaskSelection(s.doc, s.selection),
    canMakeCompound: canMakeCompoundPathSelection(s.doc, s.selection),
    canReleaseCompound: canReleaseCompoundPathSelection(s.doc, s.selection),
    canConvertToPath: roots.some((id) => canConvertShapeToPath(s.doc.nodes[id])),
    canPathOp: shapeRoots.some((sh) => sh.type === "path"),
    canJoin:
      roots.length >= 1 &&
      shapeRoots.length === roots.length &&
      shapeRoots.every((sh) => sh.type === "path") &&
      parents.size === 1 &&
      shapeRoots.reduce(
        (n, sh) => n + (sh.type === "path" ? joinableSubpathCount(sh) : 0),
        0
      ) >= 2,
    canSplitSubpaths: roots.some((id) => canSplitSubpaths(s.doc.nodes[id])),
    canBoolean:
      shapeRoots.length === roots.length &&
      roots.length >= 2 &&
      parents.size === 1 &&
      shapeRoots.every(isAreal),
    canOutline: shapeRoots.some(
      (sh) =>
        sh.type !== "text" &&
        sh.type !== "image" &&
        sh.stroke !== null &&
        sh.strokeWidth > 0
    ),
    canMakeSymbol: roots.length >= 1 && parents.size === 1,
    /** The one selected container that focus would isolate, if any. */
    focusTarget:
      roots.length === 1 &&
      (isGroup(s.doc.nodes[roots[0]]) || isFrame(s.doc.nodes[roots[0]]))
        ? roots[0]
        : null,
    hasInstances: instanceRoots.length > 0,
    singleInstance:
      singleInstanceNode && isInstance(singleInstanceNode)
        ? singleInstanceNode
        : null,
  };
}

/**
 * The container of every selected node, skipping the focus root (the scope's
 * own container, not a layer the user can select inside it). Empty at the top
 * of the scope, which is also what disables "Select parent".
 */
function selectionParentIds(s: EditorState): string[] {
  const scope = currentFocusRoot(s);
  const ids = new Set<string>();
  for (const id of selectionRoots(s.doc, s.selection)) {
    const parent = parentIdOf(s.doc, id);
    if (parent && parent !== scope) ids.add(parent);
  }
  return [...ids];
}

/**
 * The direct children of every selected container, skipping hidden and locked
 * ones (they cannot be acted on anyway). Empty when nothing selected holds
 * children, which is also what disables "Select contents".
 */
function selectableChildIds(s: EditorState): string[] {
  const ids: string[] = [];
  for (const id of s.selection) {
    for (const child of childIdsOf(s.doc, id)) {
      if (!isNodeHidden(s.doc, child) && !isNodeLocked(s.doc, child)) ids.push(child);
    }
  }
  return ids;
}

/** Whether the current node selection has an anchor that would cut a contour. */
function canCutNodes(s: EditorState): boolean {
  for (const [shapeId, cuts] of groupEditNodesByShape(s.editNodes)) {
    const shape = s.doc.nodes[shapeId];
    if (isShape(shape) && shape.type === "path" && hasCuttableNodes(shape, cuts))
      return true;
  }
  return false;
}

/**
 * Ratio per `[` / `]` press. Geometric rather than additive so the steps stay
 * proportionate whether the stroke is hairline or heavy.
 */
const WIDTH_STEP = 1.2;

/** Whether the node selection contains anchors of a brush stroke. */
function hasBrushNodes(s: EditorState): boolean {
  for (const shapeId of groupEditNodesByShape(s.editNodes).keys()) {
    const shape = s.doc.nodes[shapeId];
    if (isShape(shape) && shape.type === "brush") return true;
  }
  return false;
}

/** The selected guide's id, if one is selected and actually actionable. */
function selectedGuide(s: EditorState): string | null {
  const id = s.selectedGuideId;
  if (!id || s.guidesLocked || !s.guidesVisible) return null;
  return s.doc.guides.some((guide) => guide.id === id) ? id : null;
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
    run: (s, ctx) => void s.paste(ctx?.at),
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
    id: "select.parent",
    label: "Select parent",
    group: "Selection",
    keys: [{ key: "Enter", shift: true }],
    enabled: (s) => selectionParentIds(s).length > 0,
    run: (s) => s.setSelection(selectionParentIds(s)),
  },
  {
    id: "select.children",
    label: "Select contents",
    group: "Selection",
    keys: [{ key: "Enter" }],
    enabled: (s) => selectableChildIds(s).length > 0,
    run: (s) => s.setSelection(selectableChildIds(s)),
  },
  {
    id: "edit.delete",
    label: "Delete",
    group: "Edit",
    danger: true,
    keys: [{ key: "Delete" }, { key: "Backspace" }],
    enabled: (s) =>
      s.editNodes.length > 0 || s.selection.length > 0 || selectedGuide(s) !== null,
    run: (s) => {
      const guide = selectedGuide(s);
      if (guide) s.removeGuide(guide);
      else if (s.editNodes.length) s.deleteEditNode();
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
    id: "structure.makeClippingMask",
    label: "Make clipping mask",
    group: "Arrange",
    keys: [{ key: "7", mod: true }],
    enabled: (s) => sel(s).canMakeClippingMask,
    run: (s) => s.makeClippingMaskSelected(),
  },
  {
    id: "structure.releaseClippingMask",
    label: "Release clipping mask",
    group: "Arrange",
    keys: [{ key: "7", mod: true, alt: true }],
    enabled: (s) => sel(s).canReleaseClippingMask,
    run: (s) => s.releaseClippingMaskSelected(),
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
    id: "structure.convertToPath",
    label: "Convert to path",
    group: "Path",
    enabled: (s) => sel(s).canConvertToPath,
    run: (s) => s.convertSelectedToPaths(),
  },
  {
    id: "path.outlineStroke",
    label: "Outline stroke",
    group: "Path",
    enabled: (s) => sel(s).canOutline,
    run: (s) => s.outlineStrokeSelected(),
  },
  {
    id: "path.simplify",
    label: "Simplify path",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.pathOpSelected("simplify"),
  },
  {
    id: "path.smooth",
    label: "Smooth path",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.pathOpSelected("smooth"),
  },
  {
    id: "path.flatten",
    label: "Flatten path",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.pathOpSelected("flatten"),
  },
  {
    id: "path.reverse",
    label: "Reverse path",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.pathOpSelected("reverse"),
  },
  {
    id: "path.join",
    label: "Join path",
    group: "Path",
    enabled: (s) => sel(s).canJoin,
    run: (s) => s.joinSelected(),
  },
  {
    id: "path.combine",
    label: "Combine paths",
    group: "Path",
    enabled: (s) => canCombineSelection(s.doc, s.selection),
    run: (s) => s.combineSelected(),
  },
  {
    id: "path.splitSubpaths",
    label: "Split subpaths",
    group: "Path",
    // No default chord: the obvious one (Inkscape's Ctrl+Shift+K) opens
    // Firefox's Web Console and cannot be overridden by the page.
    enabled: (s) => sel(s).canSplitSubpaths,
    run: (s) => s.splitSubpathsSelected(),
  },
  {
    id: "path.cut",
    label: "Cut path",
    group: "Path",
    enabled: (s) => canCutNodes(s),
    run: (s) => s.cutSelectedNodes(),
  },
  {
    id: "brush.width.decrease",
    label: "Thinner nodes",
    group: "Path",
    keys: [{ key: "[" }],
    enabled: (s) => hasBrushNodes(s),
    run: (s) => s.setEditNodeWidths({ factor: 1 / WIDTH_STEP }),
  },
  {
    id: "brush.width.increase",
    label: "Thicker nodes",
    group: "Path",
    keys: [{ key: "]" }],
    enabled: (s) => hasBrushNodes(s),
    run: (s) => s.setEditNodeWidths({ factor: WIDTH_STEP }),
  },
  {
    id: "path.union",
    label: "Union",
    group: "Boolean",
    enabled: (s) => sel(s).canBoolean,
    run: (s) => s.booleanSelected("union"),
  },
  {
    id: "path.subtract",
    label: "Subtract",
    group: "Boolean",
    enabled: (s) => sel(s).canBoolean,
    run: (s) => s.booleanSelected("subtract"),
  },
  {
    id: "path.intersect",
    label: "Intersect",
    group: "Boolean",
    enabled: (s) => sel(s).canBoolean,
    run: (s) => s.booleanSelected("intersect"),
  },
  {
    id: "path.exclude",
    label: "Exclude",
    group: "Boolean",
    enabled: (s) => sel(s).canBoolean,
    run: (s) => s.booleanSelected("xor"),
  },
  {
    id: "path.divide",
    label: "Divide",
    group: "Boolean",
    enabled: (s) => sel(s).canBoolean,
    run: (s) => s.divideSelected(),
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
      if (inst) s.enterSymbolInstance(inst.id);
    },
  },
  // Focus -------------------------------------------------------------------
  {
    id: "focus.enter",
    label: "Focus on selection",
    group: "Focus",
    keys: [{ key: "Enter", mod: true }],
    enabled: (s) => sel(s).focusTarget != null || sel(s).singleInstance != null,
    run: (s) => {
      // A symbol instance has no subtree of its own; focusing it means editing
      // the definition it stands for.
      const inst = sel(s).singleInstance;
      if (inst) {
        s.enterSymbolInstance(inst.id);
        return;
      }
      const target = sel(s).focusTarget;
      if (target) s.enterFocus(target);
    },
  },
  {
    id: "focus.exit",
    label: "Exit focus",
    group: "Focus",
    enabled: (s) => s.focusStack.length > 0,
    run: (s) => s.exitFocus(),
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
  { id: "tool.brush", label: "Brush tool", group: "Tools", keys: [{ key: "b" }], run: (s) => s.setTool("brush") },
  { id: "tool.eraser", label: "Eraser tool", group: "Tools", keys: [{ key: "e" }], run: (s) => s.setTool("eraser") },
  { id: "tool.pencil", label: "Pencil tool", group: "Tools", keys: [{ key: "b", shift: true }], run: (s) => s.setTool("pencil") },
  { id: "tool.bucket", label: "Bucket Fill tool", group: "Tools", keys: [{ key: "g" }], run: (s) => s.setTool("bucket") },
  { id: "tool.text", label: "Text tool", group: "Tools", keys: [{ key: "t" }], run: (s) => s.setTool("text") },
  { id: "tool.frame", label: "Frame tool", group: "Tools", keys: [{ key: "a" }], run: (s) => s.setTool("frame") },

  // Frames ------------------------------------------------------------------
  {
    id: "frame.add",
    label: "Add frame",
    group: "Frame",
    run: (s) => {
      s.setTool("frame");
      s.addFrame(screenToWorld(s.viewport, canvasCenter()));
    },
  },
  // Duplicate/delete are deliberately absent: a frame is an ordinary node, so
  // edit.duplicate / edit.delete already cover it.
  ...VIEW_COMMANDS,
  ...FILE_COMMANDS,
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
  // Shift changes digit `key` values into punctuation (Shift+1 => "!"). The
  // physical `code` keeps the intended digit and makes numeric chords stable
  // across that transformation.
  const digit = /^Digit([0-9])$/.exec(e.code)?.[1];
  if (evKey !== want && digit !== want) return false;
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
