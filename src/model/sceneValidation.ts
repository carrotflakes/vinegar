import { hasValidClippingMasks } from "./clippingMask";
import { isCompoundChild } from "@/model/path/compoundPath";
import type { Document } from "./types";

/** Whether every hierarchy-owning node preserves its structural invariant. */
export function hasValidSceneContainers(doc: Document): boolean {
  return hasValidClippingMasks(doc) &&
    Object.values(doc.nodes).every(
      (node) =>
        node.type !== "compoundPath" ||
        (node.childIds.length > 0 &&
          node.childIds.every((id) => isCompoundChild(doc.nodes[id])))
    );
}

/**
 * Global colours' structural invariants: `swatchOrder` and `swatches` are a
 * bijection, and no swatch stores a reference (v1 keeps them concrete/solid, so
 * there are no chains or cycles to resolve). Reference *targets* are not checked
 * here — a dangling `swatch` fill is tolerated (render/export skip it).
 */
export function hasValidSwatches(doc: Document): boolean {
  const ids = Object.keys(doc.swatches);
  if (ids.length !== doc.swatchOrder.length) return false;
  if (doc.swatchOrder.some((id) => !doc.swatches[id])) return false;
  return Object.values(doc.swatches).every((sw) => sw.paint.type === "solid");
}
