import { hasValidClippingMasks } from "./clippingMask";
import { isCompoundChild } from "@/model/path/compoundPath";
import type { Document, SceneNode } from "./types";

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
    hasAcyclicModifierOperands(doc) &&
    hasValidClippingMasks(doc) &&
    Object.values(doc.nodes).every(
      (node) =>
        node.type !== "compoundPath" ||
        (node.childIds.length > 0 &&
          node.childIds.every((id) => isCompoundChild(doc.nodes[id], doc)))
    );
}

/**
 * The geometry a node's resolved outline reads besides its own: the operands of
 * its enabled boolean modifiers, plus a compound path's components (whose
 * outlines it paints as one). Disabled and dangling stages read nothing.
 */
function geometryDeps(doc: Document, node: SceneNode): string[] {
  const deps: string[] = [];
  if (node.type === "compoundPath") deps.push(...node.childIds);
  if (node.type === "path") {
    for (const modifier of node.modifiers ?? []) {
      if (modifier.enabled === false || modifier.type !== "boolean") continue;
      if (doc.nodes[modifier.operandId]) deps.push(modifier.operandId);
    }
  }
  return deps;
}

/**
 * Whether the geometry-reference graph is a DAG. A boolean modifier is the one
 * edge a node can draw to another node's geometry, and a cycle there has no
 * fixed point — so `transact` rejects it the way it rejects a malformed tree,
 * and the edit surfaces refuse to create one in the first place (they can say
 * *why*, which a rejected transaction cannot). See docs/parameters.md.
 */
export function hasAcyclicModifierOperands(doc: Document): boolean {
  const done = new Set<string>();
  const stack = new Set<string>();
  const visit = (id: string): boolean => {
    if (stack.has(id)) return false;
    if (done.has(id)) return true;
    const node = doc.nodes[id];
    if (!node) return true;
    stack.add(id);
    const ok = geometryDeps(doc, node).every(visit);
    stack.delete(id);
    done.add(id);
    return ok;
  };
  return Object.keys(doc.nodes).every(visit);
}

/**
 * Whether pointing `nodeId`'s boolean stage at `operandId` would close a cycle.
 * The edit is applied on a throwaway document rather than reasoned about, so
 * this can never disagree with the invariant it is protecting.
 */
export function wouldCycleThroughOperand(
  doc: Document,
  nodeId: string,
  operandId: string
): boolean {
  const node = doc.nodes[nodeId];
  if (!node || node.type !== "path" || !doc.nodes[operandId]) return false;
  const probe: Document = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: {
        ...node,
        modifiers: [
          ...(node.modifiers ?? []),
          { type: "boolean", op: "union", operandId },
        ],
      },
    },
  };
  return !hasAcyclicModifierOperands(probe);
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
