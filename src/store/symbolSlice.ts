// Reusable symbols: definitions live in doc.symbols (content in doc.nodes,
// outside rootIds); instances are atomic leaves. Local-view editing is
// tracked by the editingSymbols stack.

import { symbolContentBounds } from "../model/bounds";
import { IDENTITY, translation as translationMatrix } from "../model/matrix";
import {
  childIdsOf,
  descendantNodeIds,
  instanceIdsOf,
  isInstance,
  parentIdOf,
  selectionRoots,
  wouldCreateSymbolCycle,
} from "../model/scene";
import {
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
  currentSymbolScope,
  type StoreCtx,
  type SymbolActions,
} from "./state";

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
      transact(next); set({ selection: [instId], ...clearTransient });
    },
    placeSymbolInstance: (symbolId, at) => {
      const s = get(); const doc = s.doc;
      if (!doc.symbols[symbolId]) return;
      const scope = currentSymbolScope(s);
      if (wouldCreateSymbolCycle(doc, scope, [symbolId])) return;
      let transform: Matrix = [...IDENTITY];
      if (at) {
        const content = symbolContentBounds(doc, symbolId);
        if (content) transform = translationMatrix(at.x - content.x - content.width / 2, at.y - content.y - content.height / 2);
      }
      const id = makeId("instance");
      const next = appendToScope({ ...doc, nodes: { ...doc.nodes, [id]: instanceNode(id, symbolId, transform) } }, scope, [id]);
      transact(next); set({ selection: [id], ...clearTransient });
    },
    detachSelectedInstances: () => {
      let doc = get().doc; const selected: string[] = [];
      for (const id of selectionRoots(doc, get().selection)) {
        const inst = doc.nodes[id];
        if (!isInstance(inst)) continue;
        const def = doc.symbols[inst.symbolId]; if (!def) continue;
        const contentIds = childIdsOf(doc, def.rootNodeId);
        const all = contentIds.flatMap((cid) => [cid, ...descendantNodeIds(doc, cid)]);
        const payloadNodes: Record<string, SceneNode> = {};
        for (const nid of all) payloadNodes[nid] = structuredClone(doc.nodes[nid]);
        const dup = remapPayload({ nodes: payloadNodes, rootIds: contentIds });
        const gid = makeId("group");
        const group: Group = {
          id: gid, name: def.name, type: "group", childIds: dup.rootIds,
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
      if (selected.length) { transact(doc); set({ selection: selected, ...clearTransient }); }
    },
    enterSymbolEdit: (symbolId) => { const s = get(); if (!s.doc.symbols[symbolId] || s.editingSymbols.includes(symbolId)) return; set({ editingSymbols: [...s.editingSymbols, symbolId], activeGroupId: null, selection: [], editNode: null, ...clearTransient }); },
    exitSymbolEdit: () => { const s = get(); if (!s.editingSymbols.length) return; set({ editingSymbols: s.editingSymbols.slice(0, -1), activeGroupId: null, selection: [], editNode: null, ...clearTransient }); },
    renameSymbol: (symbolId, name) => { const doc = get().doc; const def = doc.symbols[symbolId]; if (!def) return; transact({ ...doc, symbols: { ...doc.symbols, [symbolId]: { ...def, name } } }); },
    deleteSymbol: (symbolId) => {
      const s = get(); const doc = s.doc; const def = doc.symbols[symbolId]; if (!def) return;
      if (s.editingSymbols.includes(symbolId)) return;
      if (instanceIdsOf(doc, symbolId).length) return;
      const remove = new Set([def.rootNodeId, ...descendantNodeIds(doc, def.rootNodeId)]);
      const nodes = { ...doc.nodes };
      for (const id of remove) delete nodes[id];
      const symbols = { ...doc.symbols };
      delete symbols[symbolId];
      transact({ ...doc, nodes, symbols });
      set({ selection: get().selection.filter((id) => !remove.has(id)), ...clearTransient });
    },
  };
}
