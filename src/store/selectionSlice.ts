// Selection state, including the transient multi-select pivot/transform and
// the node-tool's selected anchors.

import {
  ancestorIds,
  containingFrameId,
  isGroup,
  isNodeHidden,
  isNodeLocked,
  scopeRootIds,
} from "../model/scene";
import type { Document } from "../model/types";
import {
  clearTransient,
  currentFocusRoot,
  type SelectionActions,
  type StoreCtx,
} from "./state";

/**
 * The frame the rulers should count from after a selection change: the frame
 * the new selection lives in, or the previous one when the selection says
 * nothing (empty, or entirely outside every frame). Deliberately sticky — the
 * ruler origin must not flip back and forth as things are deselected.
 */
function activeFrameForSelection(
  doc: Document,
  selection: string[],
  current: string | null
): string | null {
  for (const id of selection) {
    const frame = containingFrameId(doc, id);
    if (frame) return frame;
  }
  return current && doc.nodes[current] ? current : null;
}

export function createSelectionActions({ set, get }: StoreCtx): SelectionActions {
  /** Selection state plus the ruler's active frame, which follows from it. */
  const selected = (selection: string[]) => {
    const s = get();
    const ids = [...new Set(selection)].filter((id) => !!s.doc.nodes[id]);
    return {
      selection: ids,
      activeFrameId: activeFrameForSelection(s.doc, ids, s.activeFrameId),
      // Selecting a node hands the "what does Delete act on?" role back to the
      // scene. Canvas clicks clear the guide selection themselves, but the
      // Layers panel and the commands come through here.
      ...(ids.length ? { selectedGuideId: null } : {}),
      ...clearTransient,
    };
  };

  return {
    setSelection: (selection) => set(selected(selection)),
    setSelectionPivot: (selectionPivot) => set({ selectionPivot }),
    setSelectionTransform: (selectionTransform) => set({ selectionTransform }),
    toggleSelection: (id) => set(selected(get().selection.includes(id) ? get().selection.filter((x) => x !== id) : [...get().selection, id])),
    // Clearing says nothing about which frame the user is working in, so the
    // ruler origin stays where it was.
    clearSelection: () => set({ selection: [], ...clearTransient }),
    selectAll: () => { const s = get(); const roots = scopeRootIds(s.doc, currentFocusRoot(s)); set({ selection: roots.filter((id) => !isNodeHidden(s.doc, id) && !isNodeLocked(s.doc, id)), ...clearTransient }); },
    setEditNodes: (editNodes) => {
      const unique = new Map<string, (typeof editNodes)[number]>();
      for (const node of editNodes) {
        unique.set(`${node.shapeId}:${node.sub}:${node.index}`, node);
      }
      set({ editNodes: [...unique.values()] });
    },
    setActiveGroup: (activeGroupId) => set({ activeGroupId }),
    setActiveFrame: (id) => set({ activeFrameId: id && get().doc.nodes[id] ? id : null }),
    exitGroup: () => {
      const s = get();
      const id = s.activeGroupId;
      if (!id) return;
      // Pop to the nearest ancestor group, stopping at the focus root (drilling
      // never escapes the container being edited).
      const scope = currentFocusRoot(s);
      const parent = ancestorIds(s.doc, id).find((a) => isGroup(s.doc.nodes[a]));
      const next = parent && parent !== scope ? parent : null;
      set({
        activeGroupId: next,
        selection: s.doc.nodes[id] ? [id] : [],
        ...clearTransient,
      });
    },
  };
}
