// Document variables: named numbers and paints stored once on the document
// (doc.vars/varOrder). Paint uses reference a variable *in* the field (a `var`
// Paint), numbers *beside* it (node.bindings) — one table, two edges. Nothing
// here resolves a binding: `transact` runs `syncParamBindings` on every
// committed document, so writing the variable is enough to retune every field
// bound to it. All mutations route through history so they undo like any other
// document edit. See docs/parameters.md and docs/global-colors.md.

import { solid, varRef, type ConcretePaint } from "../model/paint";
import {
  bakeParamRefs,
  materializeBindable,
  readNumField,
  syncParamBindings,
  withBinding,
} from "../model/params";
import { isShape, selectionRoots } from "../model/scene";
import {
  bakePaintRefs,
  documentScope,
  resolvePaint,
  type PaintTarget,
} from "../model/vars";
import {
  makeId,
  numberValue,
  paintValue,
  type DocVar,
  type Document,
  type Shape,
  type VarValue,
} from "../model/types";
import { clearTransient, type StoreCtx, type VarActions } from "./state";

/** The first concrete paint on the selection and which slot it came from,
 *  preferring `fill` over `stroke` and resolving any existing reference.
 *  Null when the selection paints nothing. Gradients and patterns qualify: a
 *  variable stores any concrete paint. */
function selectionPaint(
  doc: Document,
  selection: string[]
): { paint: ConcretePaint; target: PaintTarget } | null {
  const scope = documentScope(doc);
  for (const id of selectionRoots(doc, selection)) {
    const node = doc.nodes[id];
    if (!isShape(node)) continue;
    for (const target of ["fill", "stroke"] as PaintTarget[]) {
      const resolved = resolvePaint(node[target], scope);
      if (resolved) return { paint: resolved, target };
    }
  }
  return null;
}

/** Add a variable to both the registry and the display order (bijection). */
function withVar(doc: Document, entry: DocVar): Document {
  return {
    ...doc,
    vars: { ...doc.vars, [entry.id]: entry },
    varOrder: [...doc.varOrder, entry.id],
  };
}

/** A default name for a new variable, numbered per kind. */
function defaultName(doc: Document, kind: VarValue["kind"]): string {
  const n =
    doc.varOrder.filter((id) => doc.vars[id]?.value.kind === kind).length + 1;
  return kind === "paint" ? `Color ${n}` : `Value ${n}`;
}

function newVar(doc: Document, name: string, value: VarValue): DocVar {
  return {
    id: makeId("var"),
    name: name.trim() || defaultName(doc, value.kind),
    value,
  };
}

/** Set the selected shape roots' `target` paint to `paint`. */
function applyPaintToSelection(
  doc: Document,
  selection: string[],
  target: PaintTarget,
  paint: Shape["fill"]
): { doc: Document; changed: boolean } {
  const nodes = { ...doc.nodes };
  let changed = false;
  for (const id of selectionRoots(doc, selection)) {
    const node = nodes[id];
    if (!isShape(node)) continue;
    nodes[id] = { ...node, [target]: paint } as Shape;
    changed = true;
  }
  return { doc: { ...doc, nodes }, changed };
}

export function createVarActions({ set, get, transact }: StoreCtx): VarActions {
  /** Replace one node, keeping the change out of the caller's way. */
  const commitNode = (
    doc: Document,
    nodeId: string,
    node: Document["nodes"][string],
    label: string
  ) => transact({ ...doc, nodes: { ...doc.nodes, [nodeId]: node } }, { label });

  return {
    createVar: (value, name = "") => {
      const doc = get().doc;
      const entry = newVar(doc, name, value);
      transact(withVar(doc, entry), {
        label: value.kind === "paint" ? "Create document color" : "Create variable",
      });
      return entry.id;
    },

    createColorVarFromSelection: () => {
      const s = get();
      const doc = s.doc;
      // Seed the variable from the selection's fill (fallback: stroke), then
      // apply the reference back to that same slot.
      const found = selectionPaint(doc, s.selection);
      const entry = newVar(doc, "", paintValue(found?.paint ?? solid("#888888")));
      const added = withVar(doc, entry);
      const { doc: next } = applyPaintToSelection(
        added,
        s.selection,
        found?.target ?? "fill",
        varRef(entry.id)
      );
      transact(next, { label: "Create document color" });
      set({ selection: s.selection, ...clearTransient });
    },

    updateVar: (id, patch) => {
      const doc = get().doc;
      const entry = doc.vars[id];
      if (!entry) return;
      // A variable's type is fixed at creation: an edit may retune it, never
      // turn a colour into a number (every use would have to be rewritten).
      if (patch.value && patch.value.kind !== entry.value.kind) return;
      const next = { ...doc, vars: { ...doc.vars, [id]: { ...entry, ...patch } } };
      // A number edit rewrites every bound node, so a scrub batches into one
      // undo step through the interaction pattern rather than by coalescing
      // per-frame transactions — the same reason shape slider drags do.
      // `setDoc` publishes intermediate states without going through
      // `transact`, so this path has to resolve the bindings itself.
      if (get()._interaction) {
        get().setDoc(syncParamBindings(next));
        return;
      }
      transact(next, {
        label: entry.value.kind === "paint" ? "Edit document color" : "Edit variable",
        coalesceKey: `var:${id}:${Object.keys(patch).sort().join(",")}`,
      });
    },

    deleteVar: (id) => {
      const doc = get().doc;
      if (!doc.vars[id]) return;
      // Detach every use first — paint references bake to the concrete paint,
      // bound fields keep the number they show — so nothing dangles and
      // nothing moves.
      const nodes = bakeParamRefs(
        { ...doc, nodes: bakePaintRefs(doc, { varId: id }) },
        { varId: id }
      );
      const vars = { ...doc.vars };
      delete vars[id];
      transact(
        { ...doc, nodes, vars, varOrder: doc.varOrder.filter((vid) => vid !== id) },
        { label: "Delete variable" }
      );
    },

    reorderVar: (id, index) => {
      const doc = get().doc;
      const from = doc.varOrder.indexOf(id);
      if (from < 0) return;
      const order = [...doc.varOrder];
      order.splice(from, 1);
      order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
      if (order.every((vid, i) => vid === doc.varOrder[i])) return;
      transact({ ...doc, varOrder: order }, { label: "Reorder variables" });
    },

    applyColorVar: (id, target) => {
      const s = get();
      const doc = s.doc;
      if (doc.vars[id]?.value.kind !== "paint") return;
      const { doc: next, changed } = applyPaintToSelection(
        doc,
        s.selection,
        target,
        varRef(id)
      );
      if (changed) transact(next, { label: "Apply document color" });
    },

    unlinkPaint: (nodeIds, target) => {
      const doc = get().doc;
      const nodes = bakePaintRefs(doc, { nodeIds, target });
      if (nodes !== doc.nodes) transact({ ...doc, nodes }, { label: "Unlink document color" });
    },

    bindField: (nodeId, path, varId, scale) => {
      const doc = get().doc;
      const value = doc.vars[varId]?.value;
      const node = doc.nodes[nodeId] && materializeBindable(doc.nodes[nodeId], path);
      if (!value || value.kind !== "number" || !node) return;
      const current = readNumField(node, path);
      if (current === null) return;
      // Default the multiplier so the field keeps the value it is showing:
      // binding is a link, not an edit. A zero variable has no such ratio, so
      // it falls back to 1 and the field follows the variable outright.
      const ratio = scale ?? (value.value === 0 ? 1 : current / value.value);
      commitNode(
        doc,
        nodeId,
        withBinding(node, path, { varId, scale: Number.isFinite(ratio) ? ratio : 1 }),
        "Bind to variable"
      );
    },

    unbindField: (nodeId, path) => {
      const doc = get().doc;
      const node = doc.nodes[nodeId];
      if (!node || !node.bindings[path]) return;
      commitNode(doc, nodeId, withBinding(node, path, null), "Unbind variable");
    },

    unbindAll: (nodeIds) => {
      const doc = get().doc;
      const nodes = bakeParamRefs(doc, nodeIds ? { nodeIds } : {});
      if (nodes !== doc.nodes) transact({ ...doc, nodes }, { label: "Unbind variables" });
    },

    bindFieldToNewVar: (nodeId, path, name) => {
      const doc = get().doc;
      const node = doc.nodes[nodeId] && materializeBindable(doc.nodes[nodeId], path);
      if (!node) return;
      const value = readNumField(node, path);
      if (value === null) return;
      const entry = newVar(
        doc,
        name,
        numberValue(value, { integer: Number.isInteger(value) })
      );
      commitNode(
        withVar(doc, entry),
        nodeId,
        withBinding(node, path, { varId: entry.id, scale: 1 }),
        "Bind to new variable"
      );
    },
  };
}
