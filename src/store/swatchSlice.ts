// Global colours ("document colours"): named solid paints stored on the
// document (doc.swatches/swatchOrder). Nodes reference them by id through a
// `swatch` Paint variant, so editing a swatch re-tints every use live. All
// mutations route through history so they undo like any document edit.
// See docs/global-colors.md.

import {
  resolvePaintRef,
  solid,
  swatchRef,
  type SolidPaint,
} from "../model/paint";
import { isShape, selectionRoots } from "../model/scene";
import { bakeSwatchRefs, type PaintTarget } from "../model/swatches";
import { makeId, type Document, type Shape, type Swatch } from "../model/types";
import {
  clearTransient,
  type StoreCtx,
  type SwatchActions,
} from "./state";

/** The first solid paint on the selection and which slot it came from,
 *  preferring `fill` over `stroke` and resolving any existing swatch reference.
 *  Null when the selection has no solid paint. */
function selectionSolid(
  doc: Document,
  selection: string[]
): { paint: SolidPaint; target: PaintTarget } | null {
  for (const id of selectionRoots(doc, selection)) {
    const node = doc.nodes[id];
    if (!isShape(node)) continue;
    for (const target of ["fill", "stroke"] as PaintTarget[]) {
      const resolved = resolvePaintRef(node[target], doc.swatches);
      if (resolved?.type === "solid") return { paint: resolved, target };
    }
  }
  return null;
}

/** Add a swatch to both the registry and the display order (keeps the bijection). */
function withSwatch(doc: Document, swatch: Swatch): Document {
  return {
    ...doc,
    swatches: { ...doc.swatches, [swatch.id]: swatch },
    swatchOrder: [...doc.swatchOrder, swatch.id],
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

export function createSwatchActions({ set, get, transact }: StoreCtx): SwatchActions {
  return {
    createSwatch: (name, paint) => {
      const doc = get().doc;
      const id = makeId("swatch");
      const label = name.trim() || `Color ${doc.swatchOrder.length + 1}`;
      transact(withSwatch(doc, { id, name: label, paint }), { label: "Create document color" });
      return id;
    },

    createSwatchFromSelection: () => {
      const s = get();
      const doc = s.doc;
      // Seed the swatch from the selection's fill (fallback: stroke), then apply
      // the reference back to that same slot.
      const found = selectionSolid(doc, s.selection);
      const id = makeId("swatch");
      const name = `Color ${doc.swatchOrder.length + 1}`;
      const added = withSwatch(doc, { id, name, paint: found?.paint ?? solid("#888888") });
      const { doc: next } = applyPaintToSelection(added, s.selection, found?.target ?? "fill", swatchRef(id));
      transact(next, { label: "Create document color" });
      set({ selection: s.selection, ...clearTransient });
    },

    updateSwatch: (id, patch) => {
      const doc = get().doc;
      const swatch = doc.swatches[id];
      if (!swatch) return;
      transact(
        { ...doc, swatches: { ...doc.swatches, [id]: { ...swatch, ...patch } } },
        { label: "Edit document color", coalesceKey: `swatch:${id}:${Object.keys(patch).sort().join(",")}` }
      );
    },

    applySwatch: (id, target) => {
      const s = get();
      const doc = s.doc;
      if (!doc.swatches[id]) return;
      const { doc: next, changed } = applyPaintToSelection(doc, s.selection, target, swatchRef(id));
      if (changed) transact(next, { label: "Apply document color" });
    },

    unlinkPaint: (nodeIds, target) => {
      const doc = get().doc;
      const nodes = bakeSwatchRefs(doc, { nodeIds, target });
      if (nodes !== doc.nodes) transact({ ...doc, nodes }, { label: "Unlink document color" });
    },

    deleteSwatch: (id) => {
      const doc = get().doc;
      if (!doc.swatches[id]) return;
      // Bake every reference to a concrete paint first, so nothing dangles.
      const nodes = bakeSwatchRefs(doc, { swatchId: id });
      const swatches = { ...doc.swatches };
      delete swatches[id];
      const swatchOrder = doc.swatchOrder.filter((sid) => sid !== id);
      transact({ ...doc, nodes, swatches, swatchOrder }, { label: "Delete document color" });
    },

    reorderSwatch: (id, index) => {
      const doc = get().doc;
      const from = doc.swatchOrder.indexOf(id);
      if (from < 0) return;
      const order = [...doc.swatchOrder];
      order.splice(from, 1);
      order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
      if (order.every((sid, i) => sid === doc.swatchOrder[i])) return;
      transact({ ...doc, swatchOrder: order }, { label: "Reorder document colors" });
    },
  };
}
