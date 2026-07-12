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
import { createHistory } from "./historySlice";
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
    resetCoalesce: history.resetCoalesce,
  };
  return {
    doc: createEmptyDocument(),
    selection: [],
    selectionPivot: null,
    selectionTransform: null,
    editingSymbols: [],
    selectedArtboardId: null,
    history: { past: [], future: [] },
    editNode: null,
    clipboard: null,
    _pending: null,
    _dirty: false,
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

export function styleFromDefaults(style: StyleDefaults) {
  return { fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth, opacity: 1, transform: [...IDENTITY] as Shape["transform"], transformOrigin: null };
}
