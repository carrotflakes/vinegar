import type { Document, Group, Matrix, SceneNode, Shape } from "./types";

export const isGroup = (node: SceneNode | undefined): node is Group =>
  node?.type === "group";

export const isShape = (node: SceneNode | undefined): node is Shape =>
  !!node && node.type !== "group";

export interface SceneIndex {
  parent: Map<string, string | null>;
  depth: Map<string, number>;
  ancestors: Map<string, string[]>;
  world: Map<string, Matrix>;
  hidden: Map<string, boolean>;
  locked: Map<string, boolean>;
  nodeIds: string[];
  shapeIds: string[];
}

const cache = new WeakMap<Document, SceneIndex>();
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export function sceneIndex(doc: Document): SceneIndex {
  const cached = cache.get(doc);
  if (cached) return cached;
  const parent = new Map<string, string | null>();
  const depth = new Map<string, number>();
  const ancestors = new Map<string, string[]>();
  const world = new Map<string, Matrix>();
  const hidden = new Map<string, boolean>();
  const locked = new Map<string, boolean>();
  const nodeIds: string[] = [];
  const shapeIds: string[] = [];
  const visit = (
    id: string,
    parentId: string | null,
    level: number,
    parentWorld: Matrix,
    parentAncestors: string[],
    inheritedHidden: boolean,
    inheritedLocked: boolean
  ) => {
    const node = doc.nodes[id];
    if (!node || parent.has(id)) return;
    parent.set(id, parentId);
    depth.set(id, level);
    ancestors.set(id, parentAncestors);
    const nodeWorld = multiply(parentWorld, node.transform);
    world.set(id, nodeWorld);
    hidden.set(id, inheritedHidden || !!node.hidden);
    locked.set(id, inheritedLocked || !!node.locked);
    nodeIds.push(id);
    if (isGroup(node)) {
      for (const childId of node.childIds) {
        visit(
          childId,
          id,
          level + 1,
          nodeWorld,
          [id, ...parentAncestors],
          hidden.get(id)!,
          locked.get(id)!
        );
      }
    } else {
      shapeIds.push(id);
    }
  };
  for (const id of doc.rootIds) visit(id, null, 0, IDENTITY, [], false, false);
  const index = { parent, depth, ancestors, world, hidden, locked, nodeIds, shapeIds };
  cache.set(doc, index);
  return index;
}

export function parentIdOf(doc: Document, id: string): string | null {
  return sceneIndex(doc).parent.get(id) ?? null;
}

export function childIdsOf(doc: Document, parentId: string | null): string[] {
  if (parentId === null) return doc.rootIds;
  const parent = doc.nodes[parentId];
  return isGroup(parent) ? parent.childIds : [];
}

export function withChildIds(
  doc: Document,
  parentId: string | null,
  childIds: string[]
): Document {
  if (parentId === null) return { ...doc, rootIds: childIds };
  const parent = doc.nodes[parentId];
  if (!isGroup(parent)) return doc;
  return {
    ...doc,
    nodes: { ...doc.nodes, [parentId]: { ...parent, childIds } },
  };
}

export function ancestorIds(doc: Document, id: string): string[] {
  return sceneIndex(doc).ancestors.get(id) ?? [];
}

export function rootAncestorId(doc: Document, id: string): string {
  const ancestors = ancestorIds(doc, id);
  return ancestors[ancestors.length - 1] ?? id;
}

export function descendantNodeIds(doc: Document, id: string): string[] {
  const result: string[] = [];
  const visit = (nodeId: string) => {
    const node = doc.nodes[nodeId];
    if (!isGroup(node)) return;
    for (const childId of node.childIds) {
      result.push(childId);
      visit(childId);
    }
  };
  visit(id);
  return result;
}

export function descendantShapeIds(doc: Document, id: string): string[] {
  const node = doc.nodes[id];
  if (isShape(node)) return [id];
  return descendantNodeIds(doc, id).filter((childId) =>
    isShape(doc.nodes[childId])
  );
}

/** Selected nodes with descendants of another selected node removed. */
export function selectionRoots(doc: Document, ids: string[]): string[] {
  const selected = new Set(ids.filter((id) => !!doc.nodes[id]));
  return [...selected].filter(
    (id) => !ancestorIds(doc, id).some((ancestor) => selected.has(ancestor))
  );
}

export function shapesInPaintOrder(doc: Document): Shape[] {
  return sceneIndex(doc).shapeIds
    .map((id) => doc.nodes[id])
    .filter(isShape);
}

export function isNodeHidden(doc: Document, id: string): boolean {
  return sceneIndex(doc).hidden.get(id) ?? false;
}

export function isNodeLocked(doc: Document, id: string): boolean {
  return sceneIndex(doc).locked.get(id) ?? false;
}
