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
  enclosingSymbolId,
  referencedSymbolIds,
  wouldCreateSymbolCycle,
} from "../model/scene";
import { copySelectionToSystemClipboard } from "@/io/systemClipboard";
import type { Document } from "../model/types";
import {
  appendToScope,
  copyPayload,
  duplicateRoots,
  reattachPayloadResources,
  remapPayload,
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
      // Scripts, assets, swatches and parameters the destination lacks come from the
      // payload; unresolvable generator links are dropped, and a missing image
      // asset refuses the paste (the caller can fall back to plain SVG).
      const resolved = reattachPayloadResources(doc, remapped, clipboard);
      if (resolved.missingAsset) return false;
      const { nodes: reattached, scripts, assets, swatches, swatchOrder, params, paramOrder } = resolved;
      const pasted = { ...remapped, nodes: reattached };
      if (at) {
        const temp: Document = { ...doc, nodes: { ...doc.nodes, ...pasted.nodes }, rootIds: pasted.rootIds };
        const bounds = unionNodeWorldBounds(temp, pasted.rootIds);
        if (bounds) { const dx = at.x - bounds.x - bounds.width / 2; const dy = at.y - bounds.y - bounds.height / 2; for (const id of pasted.rootIds) pasted.nodes[id] = { ...pasted.nodes[id], transform: multiply(translationMatrix(dx, dy), pasted.nodes[id].transform) }; }
      }
      const next = appendToScope(
        { ...doc, nodes: { ...doc.nodes, ...pasted.nodes }, scripts, assets, swatches, swatchOrder, params, paramOrder },
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
      const { doc, selection } = get();
      const { doc: copied, newIds } = duplicateRoots(doc, selection);
      if (!newIds.length) return;
      // The copies land on top of their originals; nudge them clear.
      const nodes = { ...copied.nodes };
      for (const id of newIds) nodes[id] = applyWorldTransformToNode(copied, nodes[id], translationMatrix(PASTE_OFFSET, PASTE_OFFSET));
      transact({ ...copied, nodes }, { label: "Duplicate selection" }); set({ selection: newIds, ...clearTransient });
    },
  };
}
