// ===========================================================================
// Pure document operations shared by the editor store slices. Nothing here
// reads or writes store state; every function maps a Document to a Document.
// ===========================================================================

import {
  IDENTITY,
  multiply,
  nodeWorldMatrix,
  translation as translationMatrix,
} from "@/model/geometry/matrix";
import {
  childIdsOf,
  descendantNodeIds,
  isCompoundPath,
  isContainer,
  parentIdOf,
  scopeRootGroupId,
  selectionRoots,
  withChildIds,
} from "../model/scene";
import {
  makeId,
  type Document,
  type Group,
  type Matrix,
  type SceneNode,
  type SymbolInstance,
} from "../model/types";

export { withChildIds as replaceChildren } from "../model/scene";

export interface ClipboardPayload {
  nodes: Record<string, SceneNode>;
  rootIds: string[];
}

/** Remove the given roots (and their subtrees) from the scene. */
export function removeRoots(doc: Document, roots: string[]): Document {
  const effectiveRoots = new Set(selectionRoots(doc, roots));
  const remove = new Set(
    [...effectiveRoots].flatMap((id) => [id, ...descendantNodeIds(doc, id)])
  );
  // A compound path may not be empty. Removing its final remaining child
  // removes the compound container as well (and may in turn empty an outer
  // compound in malformed/pre-validation data).
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of Object.values(doc.nodes)) {
      if (!isCompoundPath(node) || remove.has(node.id)) continue;
      if (node.childIds.every((id) => remove.has(id))) {
        effectiveRoots.add(node.id);
        remove.add(node.id);
        for (const id of descendantNodeIds(doc, node.id)) remove.add(id);
        changed = true;
      }
    }
  }
  let next = doc;
  const parents = new Set([...effectiveRoots].map((id) => parentIdOf(doc, id)));
  for (const parent of parents) {
    next = withChildIds(next, parent, childIdsOf(next, parent).filter((id) => !remove.has(id)));
  }
  const nodes = { ...next.nodes };
  for (const id of remove) delete nodes[id];
  return { ...next, nodes };
}

/** Snapshot the selection as a payload whose roots carry world transforms. */
export function copyPayload(doc: Document, selection: string[]): ClipboardPayload | null {
  const roots = selectionRoots(doc, selection);
  if (!roots.length) return null;
  const ids = new Set(roots.flatMap((id) => [id, ...descendantNodeIds(doc, id)]));
  const nodes: Record<string, SceneNode> = {};
  for (const id of ids) nodes[id] = structuredClone(doc.nodes[id]);
  for (const id of roots) nodes[id] = { ...nodes[id], transform: nodeWorldMatrix(doc, id) };
  return { nodes, rootIds: roots };
}

/** Clone a payload under fresh ids, optionally nudging its roots. */
export function remapPayload(payload: ClipboardPayload, offset = 0): ClipboardPayload {
  const ids = new Map(Object.keys(payload.nodes).map((id) => [id, makeId(payload.nodes[id].type)]));
  const roots = new Set(payload.rootIds);
  const nodes: Record<string, SceneNode> = {};
  for (const [oldId, node] of Object.entries(payload.nodes)) {
    const id = ids.get(oldId)!;
    let next: SceneNode = { ...structuredClone(node), id };
    if (isContainer(next)) {
      next = { ...next, childIds: next.childIds.map((child) => ids.get(child)!) };
    }
    if (offset && roots.has(oldId)) next = { ...next, transform: multiply(translationMatrix(offset, offset), next.transform) };
    nodes[id] = next;
  }
  return { nodes, rootIds: payload.rootIds.map((id) => ids.get(id)!) };
}

export function groupNode(id: string, childIds: string[]): Group {
  return { id, name: "Group", type: "group", childIds, transform: [...IDENTITY], transformOrigin: null, opacity: 1 };
}

export function instanceNode(id: string, symbolId: string, transform: Matrix): SymbolInstance {
  return {
    id,
    name: "Instance",
    type: "instance",
    symbolId,
    transform,
    transformOrigin: null,
    opacity: 1,
  };
}

/** Append nodes as new top-most children of the given editing scope. */
export function appendToScope(doc: Document, scope: string | null, ids: string[]): Document {
  const parent = scopeRootGroupId(doc, scope);
  return withChildIds(doc, parent, [...childIdsOf(doc, parent), ...ids]);
}
