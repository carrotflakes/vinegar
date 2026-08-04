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
import { numberValue } from "@/model/types";
import {
  canConvertBrushToOutline,
  canConvertPathToBrush,
} from "@/model/brush/convertBrush";
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
import { useBrush } from "../store/brushStore";
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
    canFlip:
      roots.length > 0 && roots.every((id) => !isFrame(s.doc.nodes[id])),
    canMakeClippingMask: canMakeClippingMaskSelection(s.doc, s.selection),
    canReleaseClippingMask: canReleaseClippingMaskSelection(s.doc, s.selection),
    canMakeCompound: canMakeCompoundPathSelection(s.doc, s.selection),
    canReleaseCompound: canReleaseCompoundPathSelection(s.doc, s.selection),
    canConvertToPath: roots.some((id) => canConvertShapeToPath(s.doc.nodes[id])),
    canConvertToBrush: roots.some((id) => canConvertPathToBrush(s.doc.nodes[id])),
    canConvertBrushToOutline: roots.some((id) =>
      canConvertBrushToOutline(s.doc.nodes[id])
    ),
    canPathOp: shapeRoots.some((sh) => sh.type === "path"),
    canJoin:
      roots.length >= 1 &&
      shapeRoots.length === roots.length &&
      shapeRoots.every((sh) => sh.type === "path") &&
      parents.size === 1 &&
      shapeRoots.reduce(
        (n, sh) => n + (sh.type === "path" ? joinableSubpathCount(sh, s.doc) : 0),
        0
      ) >= 2,
    canSplitSubpaths: roots.some((id) => canSplitSubpaths(s.doc.nodes[id], s.doc)),
    canBoolean:
      shapeRoots.length === roots.length &&
      roots.length >= 2 &&
      parents.size === 1 &&
      shapeRoots.every((shape) => isAreal(shape, s.doc)),
    canOutline: shapeRoots.some(
      (sh) =>
        sh.type !== "text" &&
        sh.type !== "image" &&
        // A brush has no stroked centerline to outline; use "Convert to outline
        // path" for its envelope instead (strokeOutline returns nothing here).
        sh.type !== "brush" &&
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

/** Whether `[` / `]` should resize the drawing tool instead of node widths. */
function sizableTool(s: EditorState): boolean {
  return s.tool === "brush" || s.tool === "eraser";
}

/** Step the active drawing tool's own size by `factor` (see WIDTH_STEP). */
function stepToolSize(s: EditorState, factor: number): void {
  const brush = useBrush.getState();
  if (s.tool === "eraser") brush.setBrush({ eraserSize: brush.eraserSize * factor });
  else brush.setBrush({ size: brush.size * factor });
}

/** Whether the node tool currently has anchors selected. */
function hasEditNodes(s: EditorState): boolean {
  return s.editNodes.length > 0;
}

/** Whether the node selection contains anchors of a brush stroke. */
function hasBrushNodes(s: EditorState): boolean {
  for (const shapeId of groupEditNodesByShape(s.editNodes).keys()) {
    const shape = s.doc.nodes[shapeId];
    if (isShape(shape) && shape.type === "brush") return true;
  }
  return false;
}

/**
 * Arrow-key movement, in world units. Shift takes the coarse step, the usual
 * "one unit / ten units" pair; both act on the selected anchors when the node
 * tool has some, and on the selected nodes otherwise.
 */
const NUDGE_STEP = 1;
const NUDGE_STEP_COARSE = 10;

const NUDGE_COMMANDS: Command[] = (
  [
    ["Left", "ArrowLeft", -1, 0],
    ["Right", "ArrowRight", 1, 0],
    ["Up", "ArrowUp", 0, -1],
    ["Down", "ArrowDown", 0, 1],
  ] as const
).flatMap(([name, key, x, y]) =>
  ([false, true] as const).map((coarse) => {
    const step = coarse ? NUDGE_STEP_COARSE : NUDGE_STEP;
    return {
      id: `edit.nudge${name}${coarse ? "Coarse" : ""}`,
      label: coarse ? `Nudge ${name.toLowerCase()} ×10` : `Nudge ${name.toLowerCase()}`,
      group: "Edit",
      keys: [{ key, ...(coarse ? { shift: true } : {}) }],
      // The coarse variants would only pad the palette with near-duplicates.
      ...(coarse ? { hidden: true } : {}),
      enabled: (s: EditorState) => s.editNodes.length > 0 || s.selection.length > 0,
      run: (s: EditorState) => s.nudge(x * step, y * step),
    };
  })
);

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

  ...NUDGE_COMMANDS,

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
    id: "structure.flipHorizontal",
    label: "Flip horizontally",
    group: "Transform",
    keys: [{ key: "h", shift: true }],
    enabled: (s) => sel(s).canFlip,
    run: (s) => s.flipSelectedHorizontally(),
  },
  {
    id: "structure.flipVertical",
    label: "Flip vertically",
    group: "Transform",
    keys: [{ key: "v", shift: true }],
    enabled: (s) => sel(s).canFlip,
    run: (s) => s.flipSelectedVertically(),
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
    id: "structure.convertToBrush",
    label: "Convert to brush",
    group: "Path",
    enabled: (s) => sel(s).canConvertToBrush,
    run: (s) => s.convertSelectedToBrushes(),
  },
  {
    id: "structure.brushToOutline",
    label: "Convert to outline path",
    group: "Path",
    enabled: (s) => sel(s).canConvertBrushToOutline,
    run: (s) => s.convertSelectedBrushesToOutline(),
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
    id: "path.addSimplifyModifier",
    label: "Add Simplify modifier",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.addPathModifierSelected("simplify"),
  },
  {
    id: "path.addFlattenModifier",
    label: "Add Flatten modifier",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.addPathModifierSelected("flatten"),
  },
  {
    id: "path.addOffsetModifier",
    label: "Add Offset modifier",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.addPathModifierSelected("offset"),
  },
  {
    id: "path.addOutlineModifier",
    label: "Add Outline modifier",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.addPathModifierSelected("outline"),
  },
  {
    id: "path.addSmoothModifier",
    label: "Add Smooth modifier",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.addPathModifierSelected("smooth"),
  },
  {
    id: "path.addBooleanModifier",
    label: "Add Boolean modifier",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.addPathModifierSelected("boolean"),
  },
  {
    id: "path.addArrayModifier",
    label: "Add Array modifier",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.addPathModifierSelected("array"),
  },
  {
    id: "path.addRadialModifier",
    label: "Add Radial modifier",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.addPathModifierSelected("radial"),
  },
  {
    id: "path.addReverseModifier",
    label: "Add Reverse modifier",
    group: "Path",
    enabled: (s) => sel(s).canPathOp,
    run: (s) => s.addPathModifierSelected("reverse"),
  },
  {
    id: "path.applyModifiers",
    label: "Apply path modifiers",
    group: "Path",
    enabled: (s) => selectionRoots(s.doc, s.selection).some((id) => {
      const node = s.doc.nodes[id];
      return node?.type === "path" && !!node.modifiers?.length;
    }),
    run: (s) => s.applyPathModifiersSelected(),
  },
  {
    id: "var.createNumber",
    label: "New variable",
    group: "Variable",
    run: (s) => void s.createVar(numberValue(0)),
  },
  {
    id: "var.unbindSelection",
    label: "Unbind variables from selection",
    group: "Variable",
    enabled: (s) =>
      selectionRoots(s.doc, s.selection).some(
        (id) => Object.keys(s.doc.nodes[id]?.bindings ?? {}).length > 0
      ),
    run: (s) => s.unbindAll(selectionRoots(s.doc, s.selection)),
  },
  {
    id: "var.bakeAll",
    label: "Unbind all variables",
    group: "Variable",
    enabled: (s) =>
      Object.values(s.doc.nodes).some((node) => Object.keys(node.bindings).length > 0),
    run: (s) => s.unbindAll(),
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
  // Anchor kinds. The properties panel has the same three as a segmented
  // control; these give the node context menu (and the palette) the same reach.
  {
    id: "node.type.cusp",
    label: "Cusp anchor",
    group: "Path",
    enabled: hasEditNodes,
    run: (s) => s.setEditNodeType("cusp"),
  },
  {
    id: "node.type.smooth",
    label: "Smooth anchor",
    group: "Path",
    enabled: hasEditNodes,
    run: (s) => s.setEditNodeType("smooth"),
  },
  {
    id: "node.type.symmetric",
    label: "Symmetric anchor",
    group: "Path",
    enabled: hasEditNodes,
    run: (s) => s.setEditNodeType("symmetric"),
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
  // Same chords as the node-width pair above, resolved by which one applies:
  // with brush anchors selected `[` / `]` edit the artwork, and while the brush
  // or eraser is the active tool they resize the tool (the Photoshop idiom).
  {
    id: "brush.size.decrease",
    label: "Smaller brush",
    group: "Tools",
    keys: [{ key: "[" }],
    enabled: sizableTool,
    run: (s) => stepToolSize(s, 1 / WIDTH_STEP),
  },
  {
    id: "brush.size.increase",
    label: "Larger brush",
    group: "Tools",
    keys: [{ key: "]" }],
    enabled: sizableTool,
    run: (s) => stepToolSize(s, WIDTH_STEP),
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
    id: "path.combineLive",
    label: "Combine (live)",
    group: "Boolean",
    enabled: (s) => sel(s).canBoolean,
    run: (s) => s.combineSelectedLive("subtract"),
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

/**
 * Find the command bound to a keydown event. Several commands may share a chord
 * when their contexts are disjoint (`[` / `]` are node widths or brush size), so
 * the first *enabled* match wins when `s` is given. With none enabled the first
 * match is still returned: the key stays claimed by the editor rather than
 * falling through to the browser.
 */
export function matchKeydown(
  e: KeyboardEvent,
  s?: EditorState
): { cmd: Command; stroke: KeyStroke } | null {
  let first: { cmd: Command; stroke: KeyStroke } | null = null;
  for (const cmd of COMMANDS) {
    if (!cmd.keys) continue;
    for (const stroke of cmd.keys) {
      if (!strokeMatches(stroke, e)) continue;
      if (!s || commandEnabled(cmd, s)) return { cmd, stroke };
      first ??= { cmd, stroke };
    }
  }
  return first;
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
