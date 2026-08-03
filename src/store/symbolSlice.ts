// Reusable symbols: definitions live in doc.symbols (content in doc.nodes,
// outside rootIds); instances are atomic leaves. Local-view editing is one
// case of focus (isolation) editing — the focus stack holds the definition's
// root group while a symbol is open. See docs/focus.md.

import { symbolContentBounds } from "@/model/geometry/bounds";
import { isVarRef, tintPaint, varRef } from "@/model/paint";
import { resolvePaint, symbolDefScope } from "@/model/vars";
import {
  materializeBindable,
  readNumField,
  syncParamBindings,
  withBinding,
} from "@/model/params";
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
  isNodeInScope,
  isNodeLocked,
  isShape,
  parentIdOf,
  selectionRoots,
  validFocusPrefix,
  wouldCreateSymbolCycle,
} from "../model/scene";
import {
  baseNodeDefaults,
  makeId,
  numberValue,
  paintValue,
  type Document,
  type Group,
  type Matrix,
  type Shape,
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
        symbols: {
          ...doc.symbols,
          [symbolId]: { id: symbolId, name, rootNodeId: rootId, params: [] },
        },
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
      if (!next) return;
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
      if (validFocusPrefix(doc, [...s.focusStack, nodeId]).length !== s.focusStack.length + 1) return;
      set({ focusStack: [...s.focusStack, nodeId], activeGroupId: null, selection: [], ...clearTransient });
    },
    enterSymbolInstance: (instanceId) => {
      const s = get(); const doc = s.doc; const instance = doc.nodes[instanceId];
      if (!isInstance(instance)) return;
      if (isNodeHidden(doc, instanceId) || isNodeLocked(doc, instanceId)) return;
      if (!isNodeInScope(doc, instanceId, currentFocusRoot(s))) return;
      const def = doc.symbols[instance.symbolId];
      if (!def || s.focusStack.includes(def.rootNodeId)) return;
      const next = [...s.focusStack, def.rootNodeId];
      if (validFocusPrefix(doc, next).length !== next.length) return;
      set({ focusStack: next, activeGroupId: null, selection: [], ...clearTransient });
    },
    enterSymbolEdit: (symbolId) => {
      const s = get(); const def = s.doc.symbols[symbolId];
      if (!def || (s.focusStack.length === 1 && s.focusStack[0] === def.rootNodeId)) return;
      if (validFocusPrefix(s.doc, [def.rootNodeId]).length !== 1) return;
      set({ focusStack: [def.rootNodeId], activeGroupId: null, selection: [], ...clearTransient });
    },
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
    promoteToSymbolParam: (nodeId, target, label) => {
      const doc = get().doc;
      const node = doc.nodes[nodeId];
      if (!isShape(node)) return null;
      const symbolId = enclosingSymbolId(doc, nodeId);
      const def = symbolId ? doc.symbols[symbolId] : null;
      if (!def) return null;
      const paint = node[target];
      // Already a parameter of this symbol: promoting again would only shadow it.
      if (isVarRef(paint) && def.params.some((p) => p.key === paint.varId)) return null;
      // The default is what the field paints *now*, resolved through the scope
      // it lives in, so promotion never changes the picture.
      const concrete = resolvePaint(paint, symbolDefScope(doc, def));
      if (!concrete) return null;
      const key = makeId("var");
      const params = [
        ...def.params,
        {
          key,
          label: label?.trim() || `Color ${def.params.length + 1}`,
          default: paintValue(concrete),
        },
      ];
      transact(
        {
          ...doc,
          nodes: { ...doc.nodes, [nodeId]: { ...node, [target]: varRef(key) } as SceneNode },
          symbols: { ...doc.symbols, [symbolId!]: { ...def, params } },
        },
        { label: "Promote to symbol parameter" }
      );
      return key;
    },
    promoteNumberToSymbolParam: (nodeId, path, label) => {
      const doc = get().doc;
      const stored = doc.nodes[nodeId];
      if (!stored) return null;
      const symbolId = enclosingSymbolId(doc, nodeId);
      const def = symbolId ? doc.symbols[symbolId] : null;
      if (!def) return null;
      // Already driven by a parameter of this symbol: promoting again would
      // only shadow it.
      const existing = stored.bindings[path];
      if (existing && def.params.some((p) => p.key === existing.varId)) return null;
      const node = materializeBindable(stored, path);
      const value = readNumField(node, path);
      if (value === null) return null;
      const key = makeId("var");
      const params = [
        ...def.params,
        {
          key,
          label: label?.trim() || `Value ${def.params.length + 1}`,
          // The default is the number the field holds now, so promotion — like
          // binding — never changes the picture.
          default: numberValue(value, { integer: Number.isInteger(value) }),
        },
      ];
      transact(
        {
          ...doc,
          nodes: {
            ...doc.nodes,
            [nodeId]: withBinding(node, path, { varId: key, scale: 1 }),
          },
          symbols: { ...doc.symbols, [symbolId!]: { ...def, params } },
        },
        { label: "Promote to symbol parameter" }
      );
      return key;
    },
    renameSymbolParam: (symbolId, key, label) => {
      const doc = get().doc;
      const def = doc.symbols[symbolId];
      if (!def || !def.params.some((p) => p.key === key)) return;
      const params = def.params.map((p) => (p.key === key ? { ...p, label } : p));
      transact(
        { ...doc, symbols: { ...doc.symbols, [symbolId]: { ...def, params } } },
        { label: "Rename symbol parameter" }
      );
    },
    setSymbolParamDefault: (symbolId, key, value) => {
      const doc = get().doc;
      const def = doc.symbols[symbolId];
      const param = def?.params.find((p) => p.key === key);
      // A parameter's type is fixed by its default, like a document variable's.
      if (!def || !param || value.kind !== param.default.kind) return;
      const next: Document = {
        ...doc,
        symbols: {
          ...doc.symbols,
          [symbolId]: {
            ...def,
            params: def.params.map((p) =>
              p.key === key ? { ...p, default: value } : p
            ),
          },
        },
      };
      // Retuning a numeric default rewrites every bound field in the
      // definition, so a scrub batches through the interaction pattern rather
      // than by coalescing per-frame transactions — as variable edits do.
      if (get()._interaction) {
        get().setDoc(syncParamBindings(next));
        return;
      }
      transact(
        next,
        {
          label: "Edit symbol parameter",
          coalesceKey: `symbolParam:${symbolId}:${key}`,
        }
      );
    },
    removeSymbolParam: (symbolId, key) => {
      const doc = get().doc;
      const def = doc.symbols[symbolId];
      const param = def?.params.find((p) => p.key === key);
      if (!def || !param) return;
      // Bake every reference inside the definition back to the default, so the
      // drawing is unchanged, then drop the overrides that no longer address
      // anything.
      const nodes = { ...doc.nodes };
      for (const id of [def.rootNodeId, ...descendantNodeIds(doc, def.rootNodeId)]) {
        const node = nodes[id];
        if (!node) continue;
        // A numeric parameter is referenced through a binding, and the bound
        // field already holds the default (that is what `syncParamBindings`
        // writes inside a definition), so dropping the binding is the bake.
        for (const [path, ref] of Object.entries(node.bindings)) {
          if (ref.varId === key) nodes[id] = withBinding(nodes[id], path, null);
        }
        if (!isShape(node)) continue;
        let next = nodes[id] as Shape;
        for (const target of ["fill", "stroke"] as const) {
          const paint = next[target];
          if (isVarRef(paint) && paint.varId === key) {
            next = {
              ...next,
              [target]: param.default.kind === "paint"
                ? tintPaint(param.default.value, paint.alpha)
                : null,
            } as Shape;
          }
        }
        if (next !== node) nodes[id] = next;
      }
      for (const node of Object.values(nodes)) {
        if (!isInstance(node) || node.symbolId !== symbolId || !(key in node.args)) continue;
        const args = { ...node.args };
        delete args[key];
        nodes[node.id] = { ...node, args };
      }
      transact(
        {
          ...doc,
          nodes,
          symbols: {
            ...doc.symbols,
            [symbolId]: { ...def, params: def.params.filter((p) => p.key !== key) },
          },
        },
        { label: "Remove symbol parameter" }
      );
    },
    setInstanceArg: (instanceId, key, value) => {
      const doc = get().doc;
      const instance = doc.nodes[instanceId];
      if (!isInstance(instance)) return;
      const param = doc.symbols[instance.symbolId]?.params.find((p) => p.key === key);
      // An override of the wrong type would be ignored at resolution time, so
      // it is refused at the edge instead.
      if (!param || (value && value.kind !== param.default.kind)) return;
      if (!value && !(key in instance.args)) return;
      const args = { ...instance.args };
      if (value) args[key] = value;
      else delete args[key];
      transact(
        { ...doc, nodes: { ...doc.nodes, [instanceId]: { ...instance, args } } },
        {
          label: "Override symbol parameter",
          coalesceKey: `instanceArg:${instanceId}:${key}`,
        }
      );
    },
  };
}
