// Selection state, including the transient multi-select pivot/transform and
// the node-tool's active anchor.

import {
  ancestorIds,
  isGroup,
  isNodeHidden,
  isNodeLocked,
  scopeRootGroupId,
  scopeRootIds,
} from "../model/scene";
import {
  clearTransient,
  currentSymbolScope,
  type SelectionActions,
  type StoreCtx,
} from "./state";

export function createSelectionActions({ set, get }: StoreCtx): SelectionActions {
  return {
    setSelection: (selection) => set({ selection: [...new Set(selection)].filter((id) => !!get().doc.nodes[id]), ...clearTransient }),
    setSelectionPivot: (selectionPivot) => set({ selectionPivot }),
    setSelectionTransform: (selectionTransform) => set({ selectionTransform }),
    toggleSelection: (id) => set({ selection: get().selection.includes(id) ? get().selection.filter((x) => x !== id) : [...get().selection, id], ...clearTransient }),
    clearSelection: () => set({ selection: [], editNode: null, ...clearTransient }),
    selectAll: () => { const s = get(); const roots = scopeRootIds(s.doc, currentSymbolScope(s)); set({ selection: roots.filter((id) => !isNodeHidden(s.doc, id) && !isNodeLocked(s.doc, id)), ...clearTransient }); },
    setEditNode: (editNode) => set({ editNode }),
    setActiveGroup: (activeGroupId) => set({ activeGroupId }),
    exitGroup: () => {
      const s = get();
      const id = s.activeGroupId;
      if (!id) return;
      // Pop to the nearest ancestor group, stopping at the symbol scope root
      // (which is the definition container, not a user-facing group).
      const symbolRoot = scopeRootGroupId(s.doc, currentSymbolScope(s));
      const parent = ancestorIds(s.doc, id).find((a) => isGroup(s.doc.nodes[a]));
      const next = parent && parent !== symbolRoot ? parent : null;
      set({
        activeGroupId: next,
        selection: s.doc.nodes[id] ? [id] : [],
        ...clearTransient,
      });
    },
  };
}
