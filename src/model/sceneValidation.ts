import { isValidClippingMaskGroup } from "./clippingMask";
import { isCompoundChild } from "./compoundPath";
import type { Document } from "./types";

/** Whether every hierarchy-owning node preserves its structural invariant. */
export function hasValidSceneContainers(doc: Document): boolean {
  return Object.values(doc.nodes).every((node) => {
    if (node.type === "group") return isValidClippingMaskGroup(doc, node);
    if (node.type !== "compoundPath") return true;
    return node.childIds.length > 0 &&
      node.childIds.every((id) => isCompoundChild(doc.nodes[id]));
  });
}
