// Clipboard: copy/cut/paste/duplicate. The clipboard holds an in-memory
// payload whose roots carry world transforms, so pastes land where the
// source appeared regardless of its original parent.

import { unionNodeWorldBounds } from "../model/bounds";
import {
  applyWorldTransformToNode,
  multiply,
  translation as translationMatrix,
} from "../model/matrix";
import {
  childIdsOf,
  parentIdOf,
  referencedSymbolIds,
  selectionRoots,
  wouldCreateSymbolCycle,
} from "../model/scene";
import type { Document } from "../model/types";
import {
  appendToScope,
  copyPayload,
  remapPayload,
  replaceChildren,
} from "./docOps";
import {
  clearTransient,
  currentSymbolScope,
  type ClipboardActions,
  type StoreCtx,
} from "./state";

const PASTE_OFFSET = 12;

export function createClipboardActions({ set, get, transact }: StoreCtx): ClipboardActions {
  return {
    copySelected: () => set({ clipboard: copyPayload(get().doc, get().selection) }),
    cutSelected: () => { get().copySelected(); get().deleteSelected(); },
    paste: (at) => {
      const state = get(); const { clipboard, doc } = state; if (!clipboard) return;
      // Instances only paste while their symbol exists and no cycle results.
      const symbolIds = referencedSymbolIds(Object.values(clipboard.nodes));
      for (const symbolId of symbolIds) if (!doc.symbols[symbolId]) return;
      const scope = currentSymbolScope(state);
      if (wouldCreateSymbolCycle(doc, scope, symbolIds)) return;
      const pasted = remapPayload(clipboard, at ? 0 : PASTE_OFFSET);
      if (at) {
        const temp: Document = { ...doc, nodes: { ...doc.nodes, ...pasted.nodes }, rootIds: pasted.rootIds };
        const bounds = unionNodeWorldBounds(temp, pasted.rootIds);
        if (bounds) { const dx = at.x - bounds.x - bounds.width / 2; const dy = at.y - bounds.y - bounds.height / 2; for (const id of pasted.rootIds) pasted.nodes[id] = { ...pasted.nodes[id], transform: multiply(translationMatrix(dx, dy), pasted.nodes[id].transform) }; }
      }
      transact(appendToScope({ ...doc, nodes: { ...doc.nodes, ...pasted.nodes } }, scope, pasted.rootIds));
      set({ selection: pasted.rootIds, ...clearTransient });
    },
    duplicateSelected: () => {
      const { doc, selection } = get(); const roots = selectionRoots(doc, selection); if (!roots.length) return;
      const selectedByParent = new Map<string | null, string[]>();
      for (const id of roots) { const p = parentIdOf(doc, id); selectedByParent.set(p, [...(selectedByParent.get(p) ?? []), id]); }
      let next = doc; const allNew: string[] = [];
      for (const [parent, selected] of selectedByParent) {
        const raw = copyPayload(doc, selected)!;
        for (const id of raw.rootIds) raw.nodes[id] = { ...raw.nodes[id], transform: structuredClone(doc.nodes[id].transform) };
        const dup = remapPayload(raw);
        next = { ...next, nodes: { ...next.nodes, ...dup.nodes } };
        const oldToNew = new Map(selected.map((id, i) => [id, dup.rootIds[i]]));
        const siblings = childIdsOf(next, parent); const reordered: string[] = [];
        for (const id of siblings) { reordered.push(id); const copy = oldToNew.get(id); if (copy) reordered.push(copy); }
        next = replaceChildren(next, parent, reordered);
        const moved = { ...next.nodes };
        for (const id of dup.rootIds) moved[id] = applyWorldTransformToNode(next, moved[id], translationMatrix(PASTE_OFFSET, PASTE_OFFSET));
        next = { ...next, nodes: moved }; allNew.push(...dup.rootIds);
      }
      transact(next); set({ selection: allNew, ...clearTransient });
    },
  };
}
