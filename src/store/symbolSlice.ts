// Reusable symbols: definitions live in doc.symbols (content in doc.nodes,
// outside rootIds); instances are atomic leaves. Local-view editing is one
// case of focus (isolation) editing — the focus stack holds the definition's
// root group while a symbol is open. See docs/focus.md.

import { symbolContentBounds } from "@/model/geometry/bounds";
import { hasValidSceneContainers } from "../model/sceneValidation";
import { IDENTITY, translation as translationMatrix } from "@/model/geometry/matrix";
import {
  ancestorIds,
  childIdsOf,
  descendantNodeIds,
  enclosingSymbolId,
  instanceIdsOf,
  isFrame,
  isGroup,
  isInstance,
  isNodeHidden,
  isNodeLocked,
  parentIdOf,
  selectionRoots,
  wouldCreateSymbolCycle,
} from "../model/scene";
import {
  baseNodeDefaults,
  makeId,
  type Document,
  type Group,
  type Matrix,
  type SceneNode,
} from "../model/types";
import {
  appendToScope,
  groupNode,
  instanceNode,
  remapPayload,
  replaceChildren,
} from "./docOps";
import {
  clearTransient,
  currentFocusRoot,
  type StoreCtx,
  type SymbolActions,
} from "./state";
import { notifyEffectsRemoved } from "./toastStore";

export function createSymbolActions({ set, get, transact }: StoreCtx): SymbolActions {
  return {
    createSymbolFromSelection: () => {
      const s = get(); const doc = s.doc;
      const roots = selectionRoots(doc, s.selection); if (!roots.length) return;
      const parent = parentIdOf(doc, roots[0]);
      if (!roots.every((id) => parentIdOf(doc, id) === parent)) return;
      const selected = new Set(roots);
      const siblings = childIdsOf(doc, parent);
      const members = siblings.filter((id) => selected.has(id));
      const insert = siblings.indexOf(members[members.length - 1]);
      const below = siblings.slice(0, insert).filter((id) => !selected.has(id)).length;
      const rest = siblings.filter((id) => !selected.has(id));
      const symbolId = makeId("symbol");
      const rootId = makeId("group");
      const instId = makeId("instance");
      const name = `Symbol ${Object.keys(doc.symbols).length + 1}`;
      rest.splice(below, 0, instId);
      // Members keep their local transforms; the definition root and the
      // instance are both identity, so the drawing is visually unchanged.
      let next: Document = {
        ...doc,
        nodes: {
          ...doc.nodes,
          [rootId]: { ...groupNode(rootId, members), name },
          [instId]: instanceNode(instId, symbolId, [...IDENTITY]),
        },
        symbols: { ...doc.symbols, [symbolId]: { id: symbolId, name, rootNodeId: rootId } },
      };
      next = replaceChildren(next, parent, rest);
      if (!hasValidSceneContainers(next)) return;
      transact(next, { label: "Create symbol" }); set({ selection: [instId], ...clearTransient });
    },
    placeSymbolInstance: (symbolId, at) => {
      const s = get(); const doc = s.doc;
      if (!doc.symbols[symbolId]) return;
      const scope = currentFocusRoot(s);
      // Nesting is only illegal relative to the symbol being edited, which the
      // scope (a node id) has to be resolved back to.
      if (wouldCreateSymbolCycle(doc, enclosingSymbolId(doc, scope), [symbolId])) return;
      let transform: Matrix = [...IDENTITY];
      if (at) {
        const content = symbolContentBounds(doc, symbolId);
        if (content) transform = translationMatrix(at.x - content.x - content.width / 2, at.y - content.y - content.height / 2);
      }
      const id = makeId("instance");
      const next = appendToScope({ ...doc, nodes: { ...doc.nodes, [id]: instanceNode(id, symbolId, transform) } }, scope, [id]);
      transact(next, { label: "Place symbol instance" }); set({ selection: [id], ...clearTransient });
    },
    detachSelectedInstances: () => {
      let doc = get().doc; const selected: string[] = []; let effectsRemoved = false;
      for (const id of selectionRoots(doc, get().selection)) {
        const inst = doc.nodes[id];
        if (!isInstance(inst)) continue;
        const def = doc.symbols[inst.symbolId]; if (!def) continue;
        effectsRemoved ||= inst.effects.length > 0 || !!doc.nodes[def.rootNodeId]?.effects.length;
        const contentIds = childIdsOf(doc, def.rootNodeId);
        const all = contentIds.flatMap((cid) => [cid, ...descendantNodeIds(doc, cid)]);
        const payloadNodes: Record<string, SceneNode> = {};
        for (const nid of all) payloadNodes[nid] = structuredClone(doc.nodes[nid]);
        const dup = remapPayload({ nodes: payloadNodes, rootIds: contentIds });
        const gid = makeId("group");
        const group: Group = {
          id: gid, name: def.name, type: "group", childIds: dup.rootIds, clipsToMask: false, ...baseNodeDefaults(),
          transform: [...inst.transform], transformOrigin: inst.transformOrigin ? { ...inst.transformOrigin } : null,
          opacity: inst.opacity, blendMode: inst.blendMode, hidden: inst.hidden, locked: inst.locked,
        };
        const parent = parentIdOf(doc, id);
        const siblings = childIdsOf(doc, parent);
        const at = siblings.indexOf(id);
        const nodes = { ...doc.nodes, ...dup.nodes, [gid]: group };
        delete nodes[id];
        const order = [...siblings]; order.splice(at, 1, gid);
        doc = replaceChildren({ ...doc, nodes }, parent, order);
        selected.push(gid);
      }
      if (selected.length) { transact(doc, { label: "Detach symbol instance" }); set({ selection: selected, ...clearTransient }); if (effectsRemoved) notifyEffectsRemoved(); }
    },
    enterFocus: (nodeId) => {
      const s = get(); const doc = s.doc; const node = doc.nodes[nodeId];
      // Compound paths are edited with the node tool, not by isolation.
      if (!isGroup(node) && !isFrame(node)) return;
      if (isNodeHidden(doc, nodeId) || isNodeLocked(doc, nodeId)) return;
      if (s.focusStack.includes(nodeId)) return;
      // Focus only ever goes deeper, so the breadcrumb stays a real path. The
      // symbol check is what the ancestor check cannot cover from the scene
      // scope: a definition's content is never reachable except through the
      // symbol itself.
      const scope = currentFocusRoot(s);
      if (enclosingSymbolId(doc, nodeId) !== enclosingSymbolId(doc, scope)) return;
      if (scope !== null && !ancestorIds(doc, nodeId).includes(scope)) return;
      set({ focusStack: [...s.focusStack, nodeId], activeGroupId: null, selection: [], ...clearTransient });
    },
    enterSymbolEdit: (symbolId) => { const s = get(); const def = s.doc.symbols[symbolId]; if (!def || s.focusStack.includes(def.rootNodeId)) return; set({ focusStack: [...s.focusStack, def.rootNodeId], activeGroupId: null, selection: [], ...clearTransient }); },
    exitFocus: () => { const s = get(); if (!s.focusStack.length) return; set({ focusStack: s.focusStack.slice(0, -1), activeGroupId: null, selection: [], ...clearTransient }); },
    exitFocusTo: (depth) => { const s = get(); if (depth < 0 || depth >= s.focusStack.length) return; set({ focusStack: s.focusStack.slice(0, depth), activeGroupId: null, selection: [], ...clearTransient }); },
    renameSymbol: (symbolId, name) => { const doc = get().doc; const def = doc.symbols[symbolId]; if (!def) return; transact({ ...doc, symbols: { ...doc.symbols, [symbolId]: { ...def, name } } }, { label: "Rename symbol" }); },
    deleteSymbol: (symbolId) => {
      const s = get(); const doc = s.doc; const def = doc.symbols[symbolId]; if (!def) return;
      // Never delete a definition the focus stack is standing inside.
      if (s.focusStack.some((id) => enclosingSymbolId(doc, id) === symbolId)) return;
      if (instanceIdsOf(doc, symbolId).length) return;
      const remove = new Set([def.rootNodeId, ...descendantNodeIds(doc, def.rootNodeId)]);
      const nodes = { ...doc.nodes };
      for (const id of remove) delete nodes[id];
      const symbols = { ...doc.symbols };
      delete symbols[symbolId];
      transact({ ...doc, nodes, symbols }, { label: "Delete symbol" });
      set({ selection: get().selection.filter((id) => !remove.has(id)), ...clearTransient });
    },
  };
}
