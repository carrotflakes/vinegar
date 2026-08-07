// ===========================================================================
// Editor store façade. State fields and action signatures live in state.ts;
// the implementations are grouped by concern in the *Slice.ts modules and
// composed into one flat zustand store here. Import everything store-related
// from this module.
// ===========================================================================

import { create } from "zustand";
import { IDENTITY } from "@/model/geometry/matrix";
import type { MarkableShape } from "@/model/marker";
import { baseNodeDefaults, createEmptyDocument, type Shape } from "../model/types";
import { createClipboardActions } from "./clipboardSlice";
import { createHistory, trimHistoryToLimit } from "./historySlice";
import { usePreferences } from "./preferencesStore";
import { createPrefsActions, initialPrefs } from "./prefsSlice";
import { createFrameActions } from "./frameSlice";
import { createGuideActions } from "./guideSlice";
import { createSelectionActions } from "./selectionSlice";
import { createShapeActions } from "./shapeSlice";
import { createAssetActions } from "./assetSlice";
import { createPathEditActions } from "./pathEditSlice";
import { createGeneratorActions } from "./generatorSlice";
import {
  currentFocusRoot,
  type EditorState,
  type StoreCtx,
  type StyleDefaults,
} from "./state";
import { createStructureActions } from "./structureSlice";
import { createShapeOpsActions } from "./shapeOpsSlice";
import { createParamActions } from "./paramSlice";
import { createSwatchActions } from "./swatchSlice";
import { createSymbolActions } from "./symbolSlice";

export { currentFocusRoot };
export type {
  AlignType,
  EditNode,
  EditorState,
  HistoryTransactionOptions,
  StyleDefaults,
  StyleStylableFields,
  ToolId,
} from "./state";

export const useEditor = create<EditorState>((set, get) => {
  const history = createHistory(set, get);
  const ctx: StoreCtx = {
    set,
    get,
    transact: history.transact,
    replaceDocumentWithoutHistory: history.replaceDocumentWithoutHistory,
    resetCoalesce: history.resetCoalesce,
  };
  const initialDoc = createEmptyDocument();
  const initialRevision = { history: 0, maintenance: 0 };
  return {
    doc: initialDoc,
    savedDoc: initialDoc,
    _revision: initialRevision,
    _savedRevision: initialRevision,
    _docEpoch: 0,
    selection: [],
    selectionPivot: null,
    selectionTransform: null,
    focusStack: [],
    activeGroupId: null,
    activeFrameId: null,
    history: { past: [], future: [] },
    editNodes: [],
    scriptsTrusted: true,
    scriptMeta: {},
    selectedGuideId: null,
    clipboard: null,
    _interaction: null,
    ...initialPrefs(),

    ...history.actions,
    ...createPrefsActions(ctx),
    ...createSelectionActions(ctx),
    ...createShapeActions(ctx),
    ...createAssetActions(ctx),
    ...createPathEditActions(ctx),
    ...createGeneratorActions(ctx),
    ...createStructureActions(ctx),
    ...createShapeOpsActions(ctx),
    ...createFrameActions(ctx),
    ...createGuideActions(ctx),
    ...createClipboardActions(ctx),
    ...createSwatchActions(ctx),
    ...createParamActions(ctx),
    ...createSymbolActions(ctx),
  };
});

usePreferences.subscribe((state, previous) => {
  if (state.history.limit === previous.history.limit) return;
  useEditor.setState((editor) => {
    const history = trimHistoryToLimit(editor.history, state.history.limit);
    return history === editor.history ? editor : { history };
  });
});

/** Whether the document has changes since the last new / open / save. */
export function hasUnsavedChanges(
  state: Pick<EditorState, "_revision" | "_savedRevision">
): boolean {
  return !state._savedRevision || state._revision.history !== state._savedRevision.history || state._revision.maintenance !== state._savedRevision.maintenance;
}

/**
 * The marker fields of the new-shape defaults, for the tools that create a
 * shape which can carry them. Kept out of {@link styleFromDefaults} so a rect
 * or a text node never grows a field its type does not have.
 */
export function markersFromDefaults(
  style: StyleDefaults
): Pick<MarkableShape, "markerStart" | "markerEnd"> {
  return {
    ...(style.markerStart ? { markerStart: { ...style.markerStart } } : {}),
    ...(style.markerEnd ? { markerEnd: { ...style.markerEnd } } : {}),
  };
}

export function styleFromDefaults(style: StyleDefaults) {
  return {
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeDash: [...style.strokeDash],
    strokeDashOffset: style.strokeDashOffset,
    strokeCap: style.strokeCap,
    strokeJoin: style.strokeJoin,
    strokeAlignment: style.strokeAlignment,
    ...baseNodeDefaults(),
    transform: [...IDENTITY] as Shape["transform"],
  };
}
