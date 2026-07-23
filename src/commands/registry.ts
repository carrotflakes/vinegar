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
} from "@/model/path/compoundPath";
import { canConvertShapeToPath } from "@/model/path/convertToPath";
import {
  canMakeClippingMaskSelection,
  canReleaseClippingMaskSelection,
} from "../model/clippingMask";
import { createDemoDocument } from "../demo/createDemoDocument";
import { canGroupSelection, selectionUnits } from "../model/groups";
import { isAreal } from "@/model/path/boolean";
import { joinableSubpathCount } from "@/model/path/joinPath";
import { hasCuttableNodes } from "@/model/path/cutPath";
import { isInstance, isShape, parentIdOf, selectionRoots } from "../model/scene";
import { unionNodeWorldBounds } from "@/model/geometry/bounds";
import {
  artboardBounds,
  type Artboard,
  type Bounds,
  type Vec2,
} from "../model/types";
import {
  fitBoundsInViewport,
  flipAt,
  initialViewport,
  rotateAt,
  screenToWorld,
  zoomAt,
  type ViewportSize,
} from "@/model/geometry/viewport";
import {
  downloadBlob,
  downloadText,
  pickTextFile,
  pickTextFileWithName,
} from "../io/download";
import { contentBounds } from "../io/exportBounds";
import { fileSlug, uniqueFileSlugs } from "../io/exportFilenames";
import { pickImageFiles } from "../io/importImage";
import { importSvg, type ImportedSvg } from "../io/importSvg";
import { exportPng } from "../io/exportPng";
import { exportSvg } from "../io/exportSvg";
import { loadDocumentText } from "../io/openDocument";
import { serializeDocument } from "../io/serialize";
import { currentSymbolScope, hasUnsavedChanges, useEditor } from "../store/editorStore";
import { useUi } from "../store/uiStore";
import { groupEditNodesByShape } from "../store/state";
import type { EditorState } from "../store/state";
import { notify } from "../store/toastStore";
import { toggleFullscreen } from "../fullscreen";

// --- Platform-aware modifier labels --------------------------------------

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
/** Display label for the primary modifier (Cmd on macOS, Ctrl elsewhere). */
export const MOD = isMac ? "⌘" : "Ctrl";

/**
 * Guard for actions that replace the current document (new / open / demo).
 * Prompts only when there are unsaved changes; returns whether to proceed.
 */
function confirmDiscard(s: EditorState): boolean {
  if (!hasUnsavedChanges(s)) return true;
  return window.confirm("Discard unsaved changes to the current drawing?");
}

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
    hasInstances: instanceRoots.length > 0,
    singleInstance:
      singleInstanceNode && isInstance(singleInstanceNode)
        ? singleInstanceNode
        : null,
  };
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

/** The currently selected artboard, or null. */
function selectedArtboard(s: EditorState): Artboard | null {
  return s.doc.artboards.find((ab) => ab.id === s.selectedArtboardId) ?? null;
}

/** Center of the canvas viewport in screen coords (for zoom-to-center). */
export function canvasCenter(): Vec2 {
  const size = canvasViewportSize();
  return { x: size.width / 2, y: size.height / 2 };
}

/**
 * Place already-obtained image files, fitting oversized ones into ~80% of the
 * visible plane. `at` (world coords) overrides the default viewport center —
 * used by drop/context-menu placement.
 */
export async function placeImagesFitted(files: File[], at?: Vec2): Promise<void> {
  const s = useEditor.getState();
  const center = canvasCenter();
  const target = at ?? screenToWorld(s.viewport, center);
  const fitWithin = {
    width: ((center.x * 2) / s.viewport.scale) * 0.8,
    height: ((center.y * 2) / s.viewport.scale) * 0.8,
  };
  await s.placeImageFiles(files, target, fitWithin);
}

/** Place converted SVG content at the viewport center unless `at` is given. */
export function placeSvgFitted(imported: ImportedSvg, at?: Vec2): void {
  const s = useEditor.getState();
  const center = canvasCenter();
  const target = at ?? screenToWorld(s.viewport, center);
  s.placeImportedSvg(imported, target, {
    width: ((center.x * 2) / s.viewport.scale) * 0.8,
    height: ((center.y * 2) / s.viewport.scale) * 0.8,
  });
}

/** Size of the drawable canvas area in CSS pixels. */
function canvasViewportSize(): ViewportSize {
  const el = document.querySelector(".canvas-wrap");
  if (!el) return { width: window.innerWidth, height: window.innerHeight };
  const r = el.getBoundingClientRect();
  return { width: r.width, height: r.height };
}

/** Apply the shared padded fit calculation to the live canvas. */
function fitViewport(s: EditorState, bounds: Bounds | null): void {
  if (!bounds) return;
  s.setViewport(fitBoundsInViewport(bounds, canvasViewportSize()));
}

function selectionBounds(s: EditorState): Bounds | null {
  return unionNodeWorldBounds(s.doc, selectionRoots(s.doc, s.selection));
}

function drawingBounds(s: EditorState): Bounds | null {
  return contentBounds(s.doc, 0, currentSymbolScope(s));
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
    enabled: (s) =>
      s.editNodes.length > 0 ||
      s.selection.length > 0 ||
      s.selectedArtboardId != null,
    run: (s) => {
      if (s.editNodes.length) s.deleteEditNode();
      else if (s.selectedArtboardId) s.deleteArtboard(s.selectedArtboardId);
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
    id: "path.cut",
    label: "Cut path",
    group: "Path",
    enabled: (s) => canCutNodes(s),
    run: (s) => s.cutSelectedNodes(),
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
  { id: "tool.brush", label: "Brush tool", group: "Tools", keys: [{ key: "b" }], run: (s) => s.setTool("brush") },
  { id: "tool.eraser", label: "Eraser tool", group: "Tools", keys: [{ key: "e" }], run: (s) => s.setTool("eraser") },
  { id: "tool.pencil", label: "Pencil tool", group: "Tools", keys: [{ key: "b", shift: true }], run: (s) => s.setTool("pencil") },
  { id: "tool.bucket", label: "Bucket Fill tool", group: "Tools", keys: [{ key: "g" }], run: (s) => s.setTool("bucket") },
  { id: "tool.text", label: "Text tool", group: "Tools", keys: [{ key: "t" }], run: (s) => s.setTool("text") },
  { id: "tool.artboard", label: "Artboard tool", group: "Tools", keys: [{ key: "a" }], run: (s) => s.setTool("artboard") },

  // Artboards ---------------------------------------------------------------
  {
    id: "artboard.add",
    label: "Add artboard",
    group: "Artboard",
    run: (s) => {
      s.setTool("artboard");
      s.addArtboard(screenToWorld(s.viewport, canvasCenter()));
    },
  },
  {
    id: "artboard.delete",
    label: "Delete artboard",
    group: "Artboard",
    danger: true,
    enabled: (s) => s.selectedArtboardId != null,
    run: (s) => {
      if (s.selectedArtboardId) s.deleteArtboard(s.selectedArtboardId);
    },
  },

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
    id: "view.resetRotation",
    label: "Reset rotation",
    group: "View",
    enabled: (s) => s.viewport.rotation !== 0,
    run: (s) =>
      s.setViewport(rotateAt(s.viewport, canvasCenter(), -s.viewport.rotation)),
  },
  {
    id: "view.flipHorizontal",
    label: "Flip view horizontally",
    group: "View",
    keys: [{ key: "F", shift: true }],
    run: (s) => s.setViewport(flipAt(s.viewport, canvasCenter())),
  },
  {
    id: "view.fitSelection",
    label: "Fit selection",
    group: "View",
    keys: [{ key: "2", shift: true }],
    enabled: (s) => selectionBounds(s) != null,
    run: (s) => fitViewport(s, selectionBounds(s)),
  },
  {
    id: "view.fitAll",
    label: "Fit all content",
    group: "View",
    keys: [{ key: "1", shift: true }],
    enabled: (s) => drawingBounds(s) != null,
    run: (s) => fitViewport(s, drawingBounds(s)),
  },
  {
    id: "view.fitArtboard",
    label: "Fit artboard",
    group: "View",
    enabled: (s) => selectedArtboard(s) != null,
    run: (s) => {
      const artboard = selectedArtboard(s);
      fitViewport(s, artboard ? artboardBounds(artboard) : null);
    },
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
    id: "view.toggleGridVisible",
    label: "Toggle grid visibility",
    group: "View",
    run: (s) => s.toggleGridVisible(),
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
      if (!confirmDiscard(s)) return;
      s.newDocument();
    },
  },
  {
    id: "file.open",
    label: "Open…",
    group: "File",
    run: async (s) => {
      if (!confirmDiscard(s)) return;
      const text = await pickTextFile(".json,application/json");
      if (text == null) return;
      loadDocumentText(text);
    },
  },
  {
    id: "file.importSvg",
    label: "Import SVG…",
    group: "File",
    run: async (_s, ctx) => {
      const file = await pickTextFileWithName(".svg,image/svg+xml");
      if (!file) return;
      try {
        const name = file.name.replace(/\.[^.]+$/, "") || "Imported SVG";
        placeSvgFitted(importSvg(file.text, name), ctx?.at);
      } catch (err) {
        notify.error(
          "Could not import SVG:\n" +
            (err instanceof Error ? err.message : String(err))
        );
      }
    },
  },
  {
    id: "file.placeImage",
    label: "Place image…",
    group: "File",
    run: async (_s, ctx) => {
      const files = await pickImageFiles();
      if (!files.length) return;
      await placeImagesFitted(files, ctx?.at);
    },
  },
  {
    id: "file.save",
    label: "Save (.json)",
    group: "File",
    keys: [{ key: "s", mod: true }],
    run: (s) => {
      const json = serializeDocument(s.doc);
      downloadText(json, "drawing.vinegar.json", "application/json");
      s.markSaved();
    },
  },
  {
    id: "file.exportImage",
    label: "Export image…",
    group: "File",
    run: () => useUi.getState().openExport(),
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
        notify.error(err instanceof Error ? err.message : String(err));
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
        notify.error(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    id: "file.exportArtboardPng",
    label: "Export artboard PNG",
    group: "File",
    enabled: (s) => s.selectedArtboardId != null,
    run: async (s) => {
      const ab = selectedArtboard(s);
      if (!ab) return;
      try {
        const blob = await exportPng(s.doc, {
          scale: 2,
          bounds: artboardBounds(ab),
          background: ab.background ?? undefined,
        });
        downloadBlob(blob, `${fileSlug(ab.name)}.png`);
      } catch (err) {
        notify.error(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    id: "file.exportArtboardSvg",
    label: "Export artboard SVG",
    group: "File",
    enabled: (s) => s.selectedArtboardId != null,
    run: (s) => {
      const ab = selectedArtboard(s);
      if (!ab) return;
      try {
        const svg = exportSvg(s.doc, { bounds: artboardBounds(ab), background: ab.background });
        downloadText(svg, `${fileSlug(ab.name)}.svg`, "image/svg+xml");
      } catch (err) {
        notify.error(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    id: "file.exportAllArtboardsPng",
    label: "Export all artboards (PNG)",
    group: "File",
    enabled: (s) => s.doc.artboards.length > 0,
    run: async (s) => {
      try {
        const slugs = uniqueFileSlugs(s.doc.artboards.map((ab) => ab.name));
        for (const [index, ab] of s.doc.artboards.entries()) {
          const blob = await exportPng(s.doc, {
            scale: 2,
            bounds: artboardBounds(ab),
            background: ab.background ?? undefined,
          });
          downloadBlob(blob, `${slugs[index]}.png`);
        }
      } catch (err) {
        notify.error(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    id: "file.demo",
    label: "Open demo",
    group: "File",
    run: (s) => {
      if (!confirmDiscard(s)) return;
      s.loadDocument(createDemoDocument());
      s.setViewport({ scale: 0.85, rotation: 0, offset: { x: 12, y: 12 } });
    },
  },

  // App ---------------------------------------------------------------------
  {
    id: "app.preferences",
    label: "Preferences…",
    group: "App",
    run: () => useUi.getState().openPreferences(),
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
