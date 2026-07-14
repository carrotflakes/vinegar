// ===========================================================================
// Editor store façade. State fields and action signatures live in state.ts;
// the implementations are grouped by concern in the *Slice.ts modules and
// composed into one flat zustand store here. Import everything store-related
// from this module.
// ===========================================================================

import { create } from "zustand";
import { IDENTITY } from "../model/matrix";
import { createEmptyDocument, type Shape } from "../model/types";
import { createArtboardActions } from "./artboardSlice";
import { createClipboardActions } from "./clipboardSlice";
import { createHistory, trimHistoryToLimit } from "./historySlice";
import { usePreferences } from "./preferencesStore";
import { createPrefsActions, initialPrefs } from "./prefsSlice";
import { createSelectionActions } from "./selectionSlice";
import { createShapeActions } from "./shapeSlice";
import {
  currentSymbolScope,
  type EditorState,
  type StoreCtx,
  type StyleDefaults,
} from "./state";
import { createStructureActions } from "./structureSlice";
import { createSymbolActions } from "./symbolSlice";

export { currentSymbolScope };
export type {
  AlignType,
  EditNode,
  EditorState,
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
    selection: [],
    selectionPivot: null,
    selectionTransform: null,
    editingSymbols: [],
    activeGroupId: null,
    selectedArtboardId: null,
    history: { past: [], future: [] },
    editNode: null,
    clipboard: null,
    _interaction: null,
    ...initialPrefs(),

    ...history.actions,
    ...createPrefsActions(ctx),
    ...createSelectionActions(ctx),
    ...createShapeActions(ctx),
    ...createStructureActions(ctx),
    ...createArtboardActions(ctx),
    ...createClipboardActions(ctx),
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

export function useIsDirty() {
  return useEditor(hasUnsavedChanges);
}

export function styleFromDefaults(style: StyleDefaults) {
  return {
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeDash: style.strokeDash.length ? [...style.strokeDash] : undefined,
    strokeDashOffset: style.strokeDashOffset || undefined,
    strokeCap: style.strokeCap,
    strokeJoin: style.strokeJoin,
    strokeAlignment: style.strokeAlignment,
    opacity: 1,
    transform: [...IDENTITY] as Shape["transform"],
    transformOrigin: null,
  };
}
