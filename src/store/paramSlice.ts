// Document parameters ("global numbers"): named values stored on the document
// (doc.params/paramOrder) that drive bound node fields through `node.bindings`.
// Nothing here resolves anything — `transact` runs `syncParamBindings` on every
// committed document, so writing the parameter is enough to retune every field
// bound to it. All mutations route through history so they undo like any other
// document edit. See docs/parameters.md.

import {
  bakeParamRefs,
  materializeBindable,
  readNumField,
  syncParamBindings,
  withBinding,
} from "../model/params";
import { makeId, type DocParam, type Document } from "../model/types";
import { type ParamActions, type StoreCtx } from "./state";

/** Add a parameter to both the registry and the display order (bijection). */
function withParam(doc: Document, param: DocParam): Document {
  return {
    ...doc,
    params: { ...doc.params, [param.id]: param },
    paramOrder: [...doc.paramOrder, param.id],
  };
}

function newParam(doc: Document, name: string, value: number): DocParam {
  return {
    id: makeId("param"),
    name: name.trim() || `Value ${doc.paramOrder.length + 1}`,
    value,
    min: null,
    max: null,
    step: null,
    integer: Number.isInteger(value),
  };
}

export function createParamActions({ get, transact }: StoreCtx): ParamActions {
  /** Replace one node, keeping the change out of the caller's way. */
  const commitNode = (
    doc: Document,
    nodeId: string,
    node: Document["nodes"][string],
    label: string,
    extra?: Partial<Document>
  ) =>
    transact(
      { ...doc, ...extra, nodes: { ...doc.nodes, [nodeId]: node } },
      { label }
    );

  return {
    createParam: (name = "", value = 0) => {
      const doc = get().doc;
      const param = newParam(doc, name, value);
      transact(withParam(doc, param), { label: "Create parameter" });
      return param.id;
    },

    updateParam: (id, patch) => {
      const doc = get().doc;
      const param = doc.params[id];
      if (!param) return;
      const next = { ...doc, params: { ...doc.params, [id]: { ...param, ...patch } } };
      // A parameter edit rewrites every bound node, so a scrub batches into one
      // undo step through the interaction pattern rather than by coalescing
      // per-frame transactions — the same reason shape slider drags do.
      // `setDoc` publishes intermediate states without going through
      // `transact`, so this path has to resolve the bindings itself.
      if (get()._interaction) {
        get().setDoc(syncParamBindings(next));
        return;
      }
      transact(next, {
        label: "Edit parameter",
        coalesceKey: `param:${id}:${Object.keys(patch).sort().join(",")}`,
      });
    },

    deleteParam: (id) => {
      const doc = get().doc;
      if (!doc.params[id]) return;
      // Detach every binding first, so no field is left pointing at nothing.
      const nodes = bakeParamRefs(doc, { paramId: id });
      const params = { ...doc.params };
      delete params[id];
      transact(
        { ...doc, nodes, params, paramOrder: doc.paramOrder.filter((pid) => pid !== id) },
        { label: "Delete parameter" }
      );
    },

    reorderParam: (id, index) => {
      const doc = get().doc;
      const from = doc.paramOrder.indexOf(id);
      if (from < 0) return;
      const order = [...doc.paramOrder];
      order.splice(from, 1);
      order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
      if (order.every((pid, i) => pid === doc.paramOrder[i])) return;
      transact({ ...doc, paramOrder: order }, { label: "Reorder parameters" });
    },

    bindField: (nodeId, path, paramId, scale) => {
      const doc = get().doc;
      const param = doc.params[paramId];
      const node = doc.nodes[nodeId] && materializeBindable(doc.nodes[nodeId], path);
      if (!param || !node) return;
      const current = readNumField(node, path);
      if (current === null) return;
      // Default the multiplier so the field keeps the value it is showing:
      // binding is a link, not an edit. A zero parameter has no such ratio, so
      // it falls back to 1 and the field follows the parameter outright.
      const ratio = scale ?? (param.value === 0 ? 1 : current / param.value);
      commitNode(
        doc,
        nodeId,
        withBinding(node, path, { paramId, scale: Number.isFinite(ratio) ? ratio : 1 }),
        "Bind to parameter"
      );
    },

    unbindField: (nodeId, path) => {
      const doc = get().doc;
      const node = doc.nodes[nodeId];
      if (!node || !node.bindings[path]) return;
      commitNode(doc, nodeId, withBinding(node, path, null), "Unbind parameter");
    },

    unbindAll: (nodeIds) => {
      const doc = get().doc;
      const nodes = bakeParamRefs(doc, nodeIds ? { nodeIds } : {});
      if (nodes !== doc.nodes) transact({ ...doc, nodes }, { label: "Unbind parameters" });
    },

    bindFieldToNewParam: (nodeId, path, name) => {
      const doc = get().doc;
      const node = doc.nodes[nodeId] && materializeBindable(doc.nodes[nodeId], path);
      if (!node) return;
      const value = readNumField(node, path);
      if (value === null) return;
      const param = newParam(doc, name, value);
      const withNew = withParam(doc, param);
      commitNode(
        withNew,
        nodeId,
        withBinding(node, path, { paramId: param.id, scale: 1 }),
        "Bind to new parameter"
      );
    },
  };
}
