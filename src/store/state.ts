// ===========================================================================
// Editor store types. The state is one flat zustand store; its actions are
// grouped into per-concern interfaces implemented by the slice modules and
// composed into EditorState by editorStore.ts.
// ===========================================================================

import type { BoolOp } from "../model/boolean";
import type { Paint } from "../model/paint";
import type {
  Artboard,
  BlendMode,
  Document,
  Effect,
  Group,
  Matrix,
  SceneNode,
  Shape,
  StrokeAlignment,
  StrokeCap,
  StrokeJoin,
  TextShape,
  Vec2,
} from "../model/types";
import type { Viewport } from "../model/viewport";
import type { ClipboardPayload } from "./docOps";
import type { DocumentPatch } from "./documentPatches";

export type ToolId = "select" | "node" | "rect" | "ellipse" | "line" | "pen" | "pencil" | "text" | "artboard";
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

export interface HistoryEntry { patches: DocumentPatch[]; inversePatches: DocumentPatch[]; beforeRevision: number; afterRevision: number }
export interface HistoryState { past: HistoryEntry[]; future: HistoryEntry[] }
export interface DocumentRevision { history: number; maintenance: number }

export interface StyleStylableFields {
  fill: Paint | null;
  stroke: Paint | null;
  strokeWidth: number;
  strokeDash: number[] | undefined;
  strokeDashOffset: number | undefined;
  strokeCap: StrokeCap | undefined;
  strokeJoin: StrokeJoin | undefined;
  strokeAlignment: StrokeAlignment | undefined;
  opacity: number;
  blendMode: BlendMode | undefined;
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
  /** The selected artboard, or null. Mutually exclusive with node selection. */
  selectedArtboardId: string | null;
  tool: ToolId;
  viewport: Viewport;
  style: StyleDefaults;
  history: HistoryState;
  editNode: EditNode | null;
  snapEnabled: boolean;
  gridSnap: boolean;
  gridSize: number;
  recentColors: string[];
  savedSwatches: string[];
  clipboard: ClipboardPayload | null;
  /** Internal undo boundary for the active pointer interaction. */
  _interaction: {
    /** Immutable document before the interaction started. */
    before: Document;
    beforeRevision: number;
    afterRevision: number | null;
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
  setGridSize: (size: number) => void;
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
  setEditNode: (node: EditNode | null) => void;
  /** Drill into a group (double-click); null returns to top level. */
  setActiveGroup: (id: string | null) => void;
  /** Step out of the active group to its parent group (or top level). */
  exitGroup: () => void;
}

/** Document lifecycle, undo history and drag-interaction batching. */
export interface HistoryActions {
  newDocument: () => void;
  loadDocument: (doc: Document) => void;
  /** Restore a browser recovery snapshot while keeping it unsaved. */
  recoverDocument: (doc: Document) => void;
  /** Mark the current document as saved (clears the unsaved-changes flag). */
  markSaved: () => void;
  beginInteraction: () => void;
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
  /** Import image files as assets and place them centered on `at`. */
  placeImageFiles: (
    files: File[],
    at: Vec2,
    fitWithin?: { width: number; height: number }
  ) => Promise<void>;
  /** Import one image file as a document asset (no scene node) for use as a
   *  pattern fill/stroke. Resolves the new asset id, or null on failure. */
  addPatternImage: (file: File) => Promise<string | null>;
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
  applyScriptChanges: (changes: { created: Shape[]; updated: Shape[]; deleted: string[] }) => void;
  updateSelectedStyle: (patch: Partial<StyleStylableFields>) => void;
  setShapeGeometry: (id: string, patch: Partial<{ x: number; y: number; width: number; height: number }>) => void;
  setRectCornerRadius: (id: string, radius: number) => void;
  setImageLockAspect: (id: string, lock: boolean) => void;
  setClosedSelected: (closed: boolean) => void;
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
  outlineStrokeSelected: () => void;
  booleanSelected: (op: BoolOp) => void;
  makeCompoundPathSelected: () => void;
  releaseCompoundPathSelected: () => void;
  toggleHidden: (id: string) => void;
  toggleLocked: (id: string) => void;
  renameShape: (id: string, name: string) => void;
  renameGroup: (id: string, name: string) => void;
  renameNode: (id: string, name: string) => void;
  updateGroupStyle: (id: string, patch: Partial<Pick<Group, "opacity" | "blendMode" | "hidden" | "locked" | "transform" | "transformOrigin">>) => void;
  /** Replace a node's effect stack; an empty list clears it. Works on any node. */
  setNodeEffects: (id: string, effects: Effect[]) => void;
  moveNode: (id: string, parentId: string | null, index: number) => void;
}

/** Create, mutate, select and remove artboards (export/layout regions). */
export interface ArtboardActions {
  addArtboard: (at?: Vec2) => void;
  updateArtboard: (id: string, patch: Partial<Omit<Artboard, "id">>) => void;
  deleteArtboard: (id: string) => void;
  selectArtboard: (id: string | null) => void;
  /** Move artboard `id` to `toIndex` in the list (= export order). */
  reorderArtboard: (id: string, toIndex: number) => void;
}

export interface ClipboardActions {
  copySelected: () => void;
  cutSelected: () => void;
  paste: (at?: Vec2) => void;
  duplicateSelected: () => void;
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
  ArtboardActions &
  ClipboardActions &
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
  transact: (next: Document, coalesceKey?: string) => void;
  /** Publish a deliberate non-undoable document replacement. */
  replaceDocumentWithoutHistory: (
    next: Document,
    additionalState?: Partial<Pick<EditorData, "gridSize">>
  ) => void;
  resetCoalesce: () => void;
}

/**
 * Per-selection transient state, reset by selection/document changes. Node
 * selection and artboard selection are mutually exclusive, so setting a node
 * selection also drops the selected artboard. The few callers that roll back an
 * interaction while keeping the artboard selected (undo/redo, cancelInteraction)
 * restore `selectedArtboardId` explicitly.
 */
export const clearTransient = {
  selectionPivot: null,
  selectionTransform: null,
  selectedArtboardId: null,
};

/** The symbol whose definition is being edited, or null for the scene. */
export function currentSymbolScope(
  s: Pick<EditorData, "editingSymbols">
): string | null {
  return s.editingSymbols[s.editingSymbols.length - 1] ?? null;
}
