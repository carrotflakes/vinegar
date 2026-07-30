// Clipboard: copy/cut/paste/duplicate. The clipboard holds an in-memory
// payload whose roots carry world transforms, so pastes land where the
// source appeared regardless of its original parent.

import { unionNodeWorldBounds } from "@/model/geometry/bounds";
import {
  applyWorldTransformToNode,
  multiply,
  translation as translationMatrix,
} from "@/model/geometry/matrix";
import {
  childIdsOf,
  enclosingSymbolId,
  parentIdOf,
  referencedSymbolIds,
  selectionRoots,
  wouldCreateSymbolCycle,
} from "../model/scene";
import { copySelectionToSystemClipboard } from "@/io/systemClipboard";
import type { Document } from "../model/types";
import {
  appendToScope,
  copyPayload,
  reattachPayloadResources,
  remapPayload,
  replaceChildren,
} from "./docOps";
import {
  clearTransient,
  currentFocusRoot,
  type ClipboardActions,
  type StoreCtx,
} from "./state";

const PASTE_OFFSET = 12;

export function createClipboardActions({ set, get, transact }: StoreCtx): ClipboardActions {
  return {
    copySelected: () => {
      const { doc, selection, scriptsTrusted } = get();
      const payload = copyPayload(doc, selection, scriptsTrusted);
      set({ clipboard: payload });
      // Mirror to the system clipboard as SVG so it survives across tabs/apps.
      if (payload) void copySelectionToSystemClipboard(doc, payload);
    },
    cutSelected: () => { get().copySelected(); get().deleteSelected(); },
    paste: (at) => {
      const clipboard = get().clipboard;
      return clipboard ? get().pastePayload(clipboard, at) : false;
    },
    pastePayload: (clipboard, at) => {
      const state = get(); const { doc } = state;
      // Instances only paste while their symbol exists and no cycle results.
      const symbolIds = referencedSymbolIds(Object.values(clipboard.nodes));
      for (const symbolId of symbolIds) if (!doc.symbols[symbolId]) return false;
      const scope = currentFocusRoot(state);
      if (wouldCreateSymbolCycle(doc, enclosingSymbolId(doc, scope), symbolIds)) return false;
      const remapped = remapPayload(clipboard, at ? 0 : PASTE_OFFSET);
      // Scripts, assets and swatches the destination lacks come from the
      // payload; unresolvable generator links are dropped, and a missing image
      // asset refuses the paste (the caller can fall back to plain SVG).
      const resolved = reattachPayloadResources(doc, remapped, clipboard);
      if (resolved.missingAsset) return false;
      const { nodes: reattached, scripts, assets, swatches, swatchOrder } = resolved;
      const pasted = { ...remapped, nodes: reattached };
      if (at) {
        const temp: Document = { ...doc, nodes: { ...doc.nodes, ...pasted.nodes }, rootIds: pasted.rootIds };
        const bounds = unionNodeWorldBounds(temp, pasted.rootIds);
        if (bounds) { const dx = at.x - bounds.x - bounds.width / 2; const dy = at.y - bounds.y - bounds.height / 2; for (const id of pasted.rootIds) pasted.nodes[id] = { ...pasted.nodes[id], transform: multiply(translationMatrix(dx, dy), pasted.nodes[id].transform) }; }
      }
      const next = appendToScope(
        { ...doc, nodes: { ...doc.nodes, ...pasted.nodes }, scripts, assets, swatches, swatchOrder },
        scope,
        pasted.rootIds
      );
      if (!next) return false;
      transact(next, { label: "Paste" });
      set({ selection: pasted.rootIds, ...clearTransient });
      // Code arriving from a document the user never approved re-arms the
      // consent gate rather than inheriting this document's trust.
      if (resolved.addedScripts.length && !clipboard.scriptsTrusted) {
        set({ scriptsTrusted: false });
      }
      return true;
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
      transact(next, { label: "Duplicate selection" }); set({ selection: allNew, ...clearTransient });
    },
  };
}
