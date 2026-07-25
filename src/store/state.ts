// ===========================================================================
// Editor store types. The state is one flat zustand store; its actions are
// grouped into per-concern interfaces implemented by the slice modules and
// composed into EditorState by editorStore.ts.
// ===========================================================================

import type { BoolOp } from "@/model/path/boolean";
import type { PathOp } from "@/model/path/pathOps";
import type { ScriptMeta } from "@/model/generators/generators";
import type { Paint, SolidPaint } from "../model/paint";
import type {
  BaseNode,
  BlendMode,
  Document,
  Effect,
  Matrix,
  SceneNode,
  ScriptDef,
  Shape,
  Swatch,
  StrokeAlignment,
  StrokeCap,
  StrokeJoin,
  TextShape,
  Vec2,
} from "../model/types";
import type { Viewport } from "@/model/geometry/viewport";
import type { ImportedSvg } from "../io/importSvg";
import type { ClipboardPayload } from "./docOps";
import type { DocumentPatch } from "./documentPatches";

export type ToolId = "select" | "node" | "rect" | "ellipse" | "line" | "pen" | "pencil" | "brush" | "eraser" | "bucket" | "text" | "frame";
export interface EditNode { shapeId: string; sub: number; index: number }
export type AlignType = "left" | "hcenter" | "right" | "top" | "vmiddle" | "bottom";
export interface StyleDefaults {
  fill: Paint | null;
  stroke: Paint | null;
  strokeWidth: number;
  strokeDash: number[];
  strokeDashOffset: number;
  strokeCap: StrokeCap;
  strokeJoin: StrokeJoin;
  strokeAlignment: StrokeAlignment;
}

export interface HistoryEntry {
  /** Human-readable action name. Older or generic entries may omit it. */
  label?: string | undefined;
  patches: DocumentPatch[];
  inversePatches: DocumentPatch[];
  beforeRevision: number;
  afterRevision: number;
}
export interface HistoryState { past: HistoryEntry[]; future: HistoryEntry[] }
export interface DocumentRevision { history: number; maintenance: number }

export interface HistoryTransactionOptions {
  /** Human-readable action name shown in the History panel. */
  label?: string | undefined;
  /** Repeated edits with the same key may collapse into one undo step. */
  coalesceKey?: string;
}

export interface StyleStylableFields {
  fill: Paint | null;
  stroke: Paint | null;
  strokeWidth: number;
  strokeDash: number[];
  strokeDashOffset: number;
  strokeCap: StrokeCap;
  strokeJoin: StrokeJoin;
  strokeAlignment: StrokeAlignment;
  opacity: number;
  blendMode: BlendMode;
  transform: Shape["transform"];
  transformOrigin: Vec2 | null;
}

/** Plain state fields (everything that is not an action). */
export interface EditorData {
  doc: Document;
  /** The document as it was at the last new / open / save. */
  savedDoc: Document;
  _revision: DocumentRevision;
  _savedRevision: DocumentRevision | null;
  selection: string[];
  selectionPivot: Vec2 | null;
  selectionTransform: Matrix | null;
  /** Symbol edit-mode stack (local view); last entry is the one being edited. */
  editingSymbols: string[];
  /**
   * The group the user has drilled into (double-click). Canvas clicks resolve
   * to this group's direct children instead of the outermost group; null means
   * top level. Reset when the symbol scope changes.
   */
  activeGroupId: string | null;
  /**
   * The frame the rulers count from (Illustrator's "active artboard"). It
   * follows deliberate acts only — selecting a frame or something inside one,
   * or creating a frame — never panning or zooming, and stays put when the
   * selection is cleared. Null means the rulers count from the world origin.
   */
  activeFrameId: string | null;
  tool: ToolId;
  viewport: Viewport;
  style: StyleDefaults;
  history: HistoryState;
  /** Node-tool anchor selection. The last entry is the active/dragged anchor. */
  editNodes: EditNode[];
  /**
   * Worker-compiled metadata (parameter schema / errors) for document scripts,
   * keyed by script id. Session-only cache, rebuilt on demand; never persisted.
   */
  scriptMeta: Record<string, ScriptMeta>;
  /**
   * Whether the current document's generator scripts may run. Session-only
   * (never persisted, so a file can't self-approve): a freshly opened document
   * that carries scripts starts untrusted, so foreign code never compiles or
   * runs until the user explicitly enables it. Parametric shapes still display
   * from their saved geometry meanwhile.
   */
  scriptsTrusted: boolean;
  snapEnabled: boolean;
  gridSnap: boolean;
  gridVisible: boolean;
  gridSize: number;
  /** Snap to persistent guides (only ever offered while they are visible). */
  guideSnap: boolean;
  /** Show `doc.guides` on the canvas; hidden guides also stop snapping. */
  guidesVisible: boolean;
  /** Guides cannot be picked, dragged or created while locked. */
  guidesLocked: boolean;
  rulersVisible: boolean;
  /** The one selected guide, if any. Guides never enter `selection`. */
  selectedGuideId: string | null;
  recentColors: string[];
  savedSwatches: string[];
  clipboard: ClipboardPayload | null;
  /** Internal undo boundary for the active pointer interaction. */
  _interaction: {
    /** Immutable document before the interaction started. */
    before: Document;
    /** Node selection to restore if the interaction is cancelled. */
    beforeEditNodes: EditNode[];
    beforeRevision: number;
    afterRevision: number | null;
    /** Human-readable action name for the eventual undo step. */
    label?: string | undefined;
    /** Whether an intermediate document has been published. */
    dirty: boolean;
  } | null;
}

/** Tool, viewport and persisted user preferences. */
export interface PrefsActions {
  setTool: (tool: ToolId) => void;
  setViewport: (vp: Viewport) => void;
  toggleSnap: () => void;
  toggleGridSnap: () => void;
  toggleGridVisible: () => void;
  setGridSize: (size: number) => void;
  toggleGuideSnap: () => void;
  toggleGuidesVisible: () => void;
  toggleGuidesLocked: () => void;
  toggleRulers: () => void;
  addRecentColor: (hex: string) => void;
  addSwatch: (hex: string) => void;
  removeSwatch: (hex: string) => void;
  setStyle: (patch: Partial<StyleDefaults>) => void;
}

export interface SelectionActions {
  setSelection: (ids: string[]) => void;
  setSelectionPivot: (pivot: Vec2 | null) => void;
  setSelectionTransform: (transform: Matrix | null) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  selectAll: () => void;
  setEditNodes: (nodes: EditNode[]) => void;
  /** Drill into a group (double-click); null returns to top level. */
  setActiveGroup: (id: string | null) => void;
  /** Step out of the active group to its parent group (or top level). */
  exitGroup: () => void;
  /** Set the frame the rulers count from; null returns to the world origin. */
  setActiveFrame: (id: string | null) => void;
}

/** Document lifecycle, undo history and drag-interaction batching. */
export interface HistoryActions {
  newDocument: () => void;
  loadDocument: (doc: Document) => void;
  /** Restore a browser recovery snapshot while keeping it unsaved. */
  recoverDocument: (doc: Document) => void;
  /** Mark the current document as saved (clears the unsaved-changes flag). */
  markSaved: () => void;
  beginInteraction: (label?: string) => void;
  applyShapes: (next: Record<string, SceneNode>) => void;
  /** Replace the document during an active interaction; committed by endInteraction. */
  setDoc: (doc: Document) => void;
  endInteraction: () => void;
  /** Discard an in-progress interaction, rolling back to its snapshot. */
  cancelInteraction: () => void;
  undo: () => void;
  redo: () => void;
}

/** Creating and mutating individual shapes. */
export interface ShapeActions {
  addShape: (shape: Shape, select?: boolean) => void;
  addShapes: (shapes: Shape[], select?: boolean) => void;
  /**
   * Commit a brush stroke into the active drawing container: the drilled-into
   * `activeGroupId` when set, else a fresh "Drawing" group that becomes active
   * so consecutive strokes collect together (see docs/brush-strokes.md).
   */
  addBrushStroke: (shape: Shape) => void;
  /**
   * Commit a bucket-fill region (scope-view-space geometry) underneath the ink
   * that bounds it: directly above `aboveId` when given (the cover shape the
   * fill was clicked on), else at the *back* of the active drawing container —
   * the drilled-into `activeGroupId` when set, else the scope root.
   */
  addFillShape: (shape: Shape, aboveId?: string | null) => void;
  /**
   * Erase along a world-space path of the given radius: brush strokes it
   * crosses are split at their centerline into new brush pieces (or removed
   * when fully erased). One undoable step; see docs/brush-strokes.md.
   */
  eraseBrushStrokes: (pathWorld: Vec2[], radiusWorld: number) => void;
  /** Import image files as assets and place them centered on `at`. */
  placeImageFiles: (
    files: File[],
    at: Vec2,
    fitWithin?: { width: number; height: number }
  ) => Promise<void>;
  /** Place converted SVG nodes centered on `at` as one undoable group. */
  placeImportedSvg: (
    imported: ImportedSvg,
    at: Vec2,
    fitWithin?: { width: number; height: number }
  ) => void;
  /** Import one image file as a document asset (no scene node) for use as a
   *  pattern fill/stroke. Resolves the new asset id, or null on failure. */
  addPatternImage: (file: File) => Promise<string | null>;
  /** Import image files as document assets (no scene nodes) in one undoable
   *  step. Used by the Assets panel's file drop. Resolves the new asset ids. */
  importImageAssets: (files: File[]) => Promise<string[]>;
  /** Place a new image node referencing an existing asset (no re-import),
   *  centered on `at`. Used by the Assets panel's place/drag. */
  placeAssetImage: (
    assetId: string,
    at: Vec2,
    fitWithin?: { width: number; height: number }
  ) => Promise<void>;
  /** Remove one asset; ignored if any shape still references it. */
  deleteAsset: (assetId: string) => void;
  /** Remove every asset no shape references. Resolves the number removed. */
  deleteUnusedAssets: () => number;
  updateShape: (shape: Shape, select?: boolean) => void;
  updateTextShape: (
    id: string,
    patch: Partial<Pick<TextShape,
      "text" | "width" | "fontFamily" | "fontSize" | "fontWeight" |
      "italic" | "lineHeight" | "align">>
  ) => void;
  /** Refresh persisted text bounds after browser fonts become available. */
  remeasureTextShapes: () => void;
  toggleNodeSmooth: (shapeId: string, sub: number, index: number) => void;
  deleteEditNode: () => void;
  cutSelectedNodes: () => void;
  applyScriptChanges: (changes: { created: Shape[]; updated: Shape[]; deleted: string[] }) => void;
  updateSelectedStyle: (patch: Partial<StyleStylableFields>) => void;
  setShapeGeometry: (id: string, patch: Partial<{ x: number; y: number; width: number; height: number }>) => void;
  setRectCornerRadius: (id: string, radius: number) => void;
  /**
   * Insert a new parametric shape from a generator, centered on `at`. Built-ins
   * resolve synchronously; document scripts build in a Worker, so this may
   * return a Promise that settles once the node is placed.
   */
  insertGenerator: (generatorId: string, at: Vec2) => void | Promise<void>;
  /**
   * Retune a parametric node. Built-ins regenerate synchronously; document
   * scripts commit the new args immediately and patch geometry asynchronously
   * (Worker), so this may return a Promise that settles when geometry lands.
   */
  setGeneratorArgs: (id: string, args: Record<string, number>) => void | Promise<void>;
  /** Drop the generator link, leaving the current geometry as a plain node. */
  detachGenerator: (id: string) => void;
  /** Create a document generator script; resolves its new id. */
  addScript: (name: string, source: string) => string;
  /** Rename or re-source an existing document generator script. */
  updateScript: (id: string, patch: Partial<Pick<ScriptDef, "name" | "source">>) => void;
  /** Remove a document generator script (referencing nodes keep last geometry). */
  deleteScript: (id: string) => void;
  /** Approve running this document's generator scripts (user consent gate). */
  trustScripts: () => void;
  /**
   * Ensure a document script's parameter schema is compiled (in the worker) and
   * cached in `scriptMeta`. No-op when untrusted or already current for the
   * script's source. Resolves once the metadata has settled.
   */
  ensureScriptCompiled: (scriptId: string) => void | Promise<void>;
  setImageLockAspect: (id: string, lock: boolean) => void;
  setClosedSelected: (closed: boolean) => void;
  pathOpSelected: (op: PathOp) => void;
}

/** Scene-tree structure: hierarchy, order, per-node flags and conversions. */
export interface StructureActions {
  deleteSelected: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  makeClippingMaskSelected: () => void;
  releaseClippingMaskSelected: () => void;
  alignSelected: (type: AlignType) => void;
  distributeSelected: (axis: "h" | "v") => void;
  /** Replace selected primitives, brushes and compound paths with editable paths. */
  convertSelectedToPaths: () => void;
  outlineStrokeSelected: () => void;
  booleanSelected: (op: BoolOp) => void;
  /** Split overlapping selected shapes into their distinct faces (Pathfinder Divide). */
  divideSelected: () => void;
  /** Weld selected paths' open endpoints into continuous contours. */
  joinSelected: () => void;
  makeCompoundPathSelected: () => void;
  releaseCompoundPathSelected: () => void;
  toggleHidden: (id: string) => void;
  toggleLocked: (id: string) => void;
  renameNode: (id: string, name: string) => void;
  /**
   * Patch the shared BaseNode style fields of a single group or symbol
   * instance. Shapes go through updateSelectedStyle / setShapeGeometry instead.
   * `hidden`/`locked` are deliberately excluded: they apply to every node type,
   * so they belong to toggleHidden/toggleLocked rather than this narrower op.
   */
  updateNodeStyle: (id: string, patch: Partial<Pick<BaseNode, "opacity" | "blendMode" | "transform" | "transformOrigin">>) => void;
  /** Replace a node's effect stack; an empty list clears it. Works on any node. */
  setNodeEffects: (id: string, effects: Effect[]) => void;
  moveNode: (id: string, parentId: string | null, index: number) => void;
}

/**
 * Frames (export/layout container nodes). Frames are ordinary scene nodes, so
 * selection, rename, delete, duplicate, reorder and move all go through the
 * normal node actions; only creation and content-box edits need frame-specific
 * ops.
 */
export interface FrameActions {
  /** Create a frame at the top level, centered on `at`, and select it. */
  addFrame: (at?: Vec2) => void;
  /** Edit a frame's world position (`x`/`y`), content box, background or clip. */
  updateFrame: (
    id: string,
    patch: Partial<{ x: number; y: number; width: number; height: number; background: string | null; clipsContent: boolean }>
  ) => void;
}

/** Persistent ruler guides; see docs/rulers-and-guides.md. */
export interface GuideActions {
  /** Select a guide for keyboard deletion, or null to clear. */
  setSelectedGuide: (id: string | null) => void;
  /** Add a guide at a world coordinate and select it; resolves its new id. */
  addGuide: (axis: "x" | "y", position: number) => string;
  moveGuide: (id: string, position: number) => void;
  removeGuide: (id: string) => void;
  clearGuides: () => void;
}

export interface ClipboardActions {
  copySelected: () => void;
  cutSelected: () => void;
  paste: (at?: Vec2) => void;
  duplicateSelected: () => void;
}

/** Global colours ("document colours"): named swatches referenced by nodes. */
export interface SwatchActions {
  /** Create a swatch from a concrete paint; resolves its new id. */
  createSwatch: (name: string, paint: SolidPaint) => string;
  /** Create a swatch from the selection's current fill (fallback: stroke) and
   *  replace that paint with a reference in one undoable step. */
  createSwatchFromSelection: () => void;
  /** Rename or re-colour a swatch; every reference re-tints on next render. */
  updateSwatch: (id: string, patch: Partial<Pick<Swatch, "name" | "paint">>) => void;
  /** Set the selected shapes' fill/stroke to a reference to swatch `id`. */
  applySwatch: (id: string, target: "fill" | "stroke") => void;
  /** Bake references on the given nodes/target back to concrete paint. */
  unlinkPaint: (nodeIds: Iterable<string>, target: "fill" | "stroke") => void;
  /** Bake every reference to concrete paint, then remove the swatch. */
  deleteSwatch: (id: string) => void;
  /** Move a swatch to `index` in the panel display order. */
  reorderSwatch: (id: string, index: number) => void;
}

export interface SymbolActions {
  createSymbolFromSelection: () => void;
  placeSymbolInstance: (symbolId: string, at?: Vec2) => void;
  detachSelectedInstances: () => void;
  enterSymbolEdit: (symbolId: string) => void;
  exitSymbolEdit: () => void;
  renameSymbol: (symbolId: string, name: string) => void;
  deleteSymbol: (symbolId: string) => void;
}

export type EditorState = EditorData &
  PrefsActions &
  SelectionActions &
  HistoryActions &
  ShapeActions &
  StructureActions &
  FrameActions &
  GuideActions &
  ClipboardActions &
  SwatchActions &
  SymbolActions;

export type StoreSet = (
  partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)
) => void;
export type StoreGet = () => EditorState;

/** Shared wiring handed to every slice factory. */
export interface StoreCtx {
  set: StoreSet;
  get: StoreGet;
  /** Commit a document change as one undo step (optionally coalesced). */
  transact: (next: Document, options?: HistoryTransactionOptions) => void;
  /** Publish a deliberate non-undoable document replacement. */
  replaceDocumentWithoutHistory: (
    next: Document,
    additionalState?: Partial<Pick<EditorData, "gridSize">>
  ) => void;
  resetCoalesce: () => void;
}

/**
 * Per-selection transient state, reset by selection/document changes. The few
 * callers that roll back an interaction while keeping path anchors selected
 * (undo/redo, cancelInteraction) restore those fields explicitly.
 */
export const clearTransient = {
  selectionPivot: null,
  selectionTransform: null,
  editNodes: [] as EditNode[],
};

/** The symbol whose definition is being edited, or null for the scene. */
export function currentSymbolScope(
  s: Pick<EditorData, "editingSymbols">
): string | null {
  return s.editingSymbols[s.editingSymbols.length - 1] ?? null;
}

/** Bucket the flat edit-node selection by its owning shape id. */
export function groupEditNodesByShape(
  editNodes: EditNode[]
): Map<string, { sub: number; index: number }[]> {
  const byShape = new Map<string, { sub: number; index: number }[]>();
  for (const { shapeId, sub, index } of editNodes) {
    const list = byShape.get(shapeId);
    if (list) list.push({ sub, index });
    else byShape.set(shapeId, [{ sub, index }]);
  }
  return byShape;
}
