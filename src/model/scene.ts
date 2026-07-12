import type { Document, Group, Matrix, SceneNode, Shape, SymbolInstance } from "./types";

export const isGroup = (node: SceneNode | undefined): node is Group =>
  node?.type === "group";

export const isInstance = (node: SceneNode | undefined): node is SymbolInstance =>
  node?.type === "instance";

export const isShape = (node: SceneNode | undefined): node is Shape =>
  !!node && node.type !== "group" && node.type !== "instance";

export interface SceneIndex {
  parent: Map<string, string | null>;
  depth: Map<string, number>;
  ancestors: Map<string, string[]>;
  world: Map<string, Matrix>;
  hidden: Map<string, boolean>;
  locked: Map<string, boolean>;
  /** Which symbol's definition owns the node; null for scene nodes. */
  owner: Map<string, string | null>;
  nodeIds: string[];
  /** Paintable leaves (shapes and instances) in paint order, all scopes. */
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
  const owner = new Map<string, string | null>();
  const nodeIds: string[] = [];
  const shapeIds: string[] = [];
  let currentOwner: string | null = null;
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
    owner.set(id, currentOwner);
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
  // Symbol definitions are indexed with an identity base, so `world` maps
  // their content into symbol-local space (which is also the local-view
  // editing space).
  for (const def of Object.values(doc.symbols)) {
    currentOwner = def.id;
    visit(def.rootNodeId, null, 0, IDENTITY, [], false, false);
  }
  const index = { parent, depth, ancestors, world, hidden, locked, owner, nodeIds, shapeIds };
  cache.set(doc, index);
  return index;
}

/** Which symbol definition owns a node; null for scene nodes. */
export function nodeOwner(doc: Document, id: string): string | null {
  return sceneIndex(doc).owner.get(id) ?? null;
}

/**
 * Paintable leaf ids (shapes and instances) of one scope in paint order.
 * `scope` is null for the scene or a symbol id for that definition's content.
 */
export function scopeLeafIds(doc: Document, scope: string | null): string[] {
  const index = sceneIndex(doc);
  return index.shapeIds.filter((id) => index.owner.get(id) === scope);
}

/** Root group id of a symbol's definition, or null for the scene scope. */
export function scopeRootGroupId(doc: Document, scope: string | null): string | null {
  if (scope === null) return null;
  return doc.symbols[scope]?.rootNodeId ?? null;
}

/** Top-level node ids of a scope (scene rootIds or def root children). */
export function scopeRootIds(doc: Document, scope: string | null): string[] {
  const rootGroup = scopeRootGroupId(doc, scope);
  if (rootGroup === null) return doc.rootIds;
  const node = doc.nodes[rootGroup];
  return isGroup(node) ? node.childIds : [];
}

/** Symbol ids reachable from `symbolId`'s definition, including itself. */
export function reachableSymbols(doc: Document, symbolId: string): Set<string> {
  const seen = new Set<string>();
  const visitSymbol = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const def = doc.symbols[id];
    if (!def) return;
    const walk = (nodeId: string) => {
      const node = doc.nodes[nodeId];
      if (!node) return;
      if (isInstance(node)) visitSymbol(node.symbolId);
      else if (isGroup(node)) node.childIds.forEach(walk);
    };
    walk(def.rootNodeId);
  };
  visitSymbol(symbolId);
  return seen;
}

/**
 * Whether inserting instances of `symbolIds` into the definition of
 * `targetSymbolId` would make a symbol (transitively) contain itself.
 */
export function wouldCreateSymbolCycle(
  doc: Document,
  targetSymbolId: string | null,
  symbolIds: Iterable<string>
): boolean {
  if (targetSymbolId === null) return false;
  for (const id of symbolIds) {
    if (reachableSymbols(doc, id).has(targetSymbolId)) return true;
  }
  return false;
}

/** Symbol ids referenced by instances among the given nodes. */
export function referencedSymbolIds(nodes: Iterable<SceneNode>): Set<string> {
  const out = new Set<string>();
  for (const node of nodes) if (isInstance(node)) out.add(node.symbolId);
  return out;
}

/** Ids of instances of `symbolId` anywhere (scene and other definitions). */
export function instanceIdsOf(doc: Document, symbolId: string): string[] {
  return Object.values(doc.nodes)
    .filter((node): node is SymbolInstance => isInstance(node) && node.symbolId === symbolId)
    .map((node) => node.id);
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

/**
 * Outermost ancestor of `id` below the given scope root group. With a null
 * scope root this is the plain root ancestor. Used so leaf hits inside a
 * symbol's local view resolve to top-level items of that symbol, not to the
 * definition root itself.
 */
export function rootAncestorIdWithin(
  doc: Document,
  id: string,
  scopeRootGroup: string | null
): string {
  const chain = ancestorIds(doc, id);
  if (scopeRootGroup === null) return chain[chain.length - 1] ?? id;
  const at = chain.indexOf(scopeRootGroup);
  if (at === -1) return chain[chain.length - 1] ?? id;
  return at === 0 ? id : chain[at - 1];
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

export function shapesInPaintOrder(
  doc: Document,
  scope: string | null = null
): Shape[] {
  return scopeLeafIds(doc, scope)
    .map((id) => doc.nodes[id])
    .filter(isShape);
}

export function isNodeHidden(doc: Document, id: string): boolean {
  return sceneIndex(doc).hidden.get(id) ?? false;
}

export function isNodeLocked(doc: Document, id: string): boolean {
  return sceneIndex(doc).locked.get(id) ?? false;
}
