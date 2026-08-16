import { hasValidClippingMasks } from "./clippingMask";
import { isCompoundChild } from "@/model/path/compoundPath";
import type { Document } from "./types";

/**
 * Which structural invariant a document breaks, as a short phrase, or null when
 * it holds up. Only the first violation found is named — this exists so a
 * rejected edit can say *why* it was rejected (see `acceptsScene`), not to
 * enumerate the damage.
 */
export function sceneContainerViolation(doc: Document): string | null {
  // Frames live only at the top level (never inside a group/symbol/other frame),
  // so no node's childIds may reference a frame. See docs/document-model.md.
  const nestedFrame = Object.values(doc.nodes).some(
    (node) =>
      (node.type === "group" || node.type === "frame" ||
        node.type === "compoundPath") &&
      node.childIds.some((id) => doc.nodes[id]?.type === "frame")
  );
  if (nestedFrame) return "a frame is nested inside another container";
  if (!hasValidClippingMasks(doc)) return "a clipping mask is malformed";
  const badCompound = Object.values(doc.nodes).some(
    (node) =>
      node.type === "compoundPath" &&
      (node.childIds.length === 0 ||
        !node.childIds.every((id) => isCompoundChild(doc.nodes[id])))
  );
  if (badCompound) return "a compound path is empty or holds a non-path child";
  return null;
}

/** Whether every hierarchy-owning node preserves its structural invariant. */
export function hasValidSceneContainers(doc: Document): boolean {
  return sceneContainerViolation(doc) === null;
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
