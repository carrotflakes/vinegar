import { hasValidClippingMasks } from "./clippingMask";
import { isCompoundChild } from "@/model/path/compoundPath";
import type { Document } from "./types";

/** Whether every hierarchy-owning node preserves its structural invariant. */
export function hasValidSceneContainers(doc: Document): boolean {
  // Frames live only at the top level (never inside a group/symbol/other frame),
  // so no node's childIds may reference a frame. See docs/document-model.md.
  const framesOnlyAtRoot = Object.values(doc.nodes).every(
    (node) =>
      node.type !== "group" && node.type !== "frame" && node.type !== "compoundPath"
        ? true
        : node.childIds.every((id) => doc.nodes[id]?.type !== "frame")
  );
  return framesOnlyAtRoot &&
    hasValidClippingMasks(doc) &&
    Object.values(doc.nodes).every(
      (node) =>
        node.type !== "compoundPath" ||
        (node.childIds.length > 0 &&
          node.childIds.every((id) => isCompoundChild(doc.nodes[id])))
    );
}

/**
 * Document variables' structural invariant lives with the rest of the variable
 * model; re-exported here so callers keep one validation import. A variable's
 * paint is concrete — never another reference — so there are no chains or
 * cycles to resolve; that is enforced by `VarValue`'s type and by
 * `isConcretePaint` at the file boundary. Reference *targets* are not checked:
 * a dangling `var` fill is tolerated (render/export skip it).
 */
export { hasValidVars } from "./vars";
