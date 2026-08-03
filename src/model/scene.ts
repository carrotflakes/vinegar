import type { Paint } from "./paint";
import type {
  CompoundPathNode,
  Document,
  FrameNode,
  Group,
  Matrix,
  SceneNode,
  Shape,
  SymbolInstance,
  VarValue,
} from "./types";

export const isGroup = (node: SceneNode | undefined): node is Group =>
  node?.type === "group";

export const isInstance = (node: SceneNode | undefined): node is SymbolInstance =>
  node?.type === "instance";

export const isFrame = (node: SceneNode | undefined): node is FrameNode =>
  node?.type === "frame";

export const isCompoundPath = (
  node: SceneNode | undefined
): node is CompoundPathNode => node?.type === "compoundPath";

export const isContainer = (
  node: SceneNode | undefined
): node is Group | CompoundPathNode | FrameNode =>
  isGroup(node) || isCompoundPath(node) || isFrame(node);

export const isShape = (node: SceneNode | undefined): node is Shape =>
  !!node &&
  node.type !== "group" &&
  node.type !== "instance" &&
  node.type !== "frame";

export const childIdsOfNode = (
  node: SceneNode | undefined
): string[] => isContainer(node) ? node.childIds : [];

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
    inheritedLocked: boolean,
    paintable = true
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
    if (isContainer(node)) {
      if (isCompoundPath(node) && paintable) shapeIds.push(id);
      for (const childId of node.childIds) {
        visit(
          childId,
          id,
          level + 1,
          nodeWorld,
          [id, ...parentAncestors],
          hidden.get(id)!,
          locked.get(id)!,
          paintable && (isGroup(node) || isFrame(node))
        );
      }
    } else if (paintable) {
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

/**
 * Paintable leaf ids (shapes and instances) owned by a symbol definition, in
 * paint order. This is the definition's *content*, independent of what the
 * user is currently editing — see {@link scopeLeafIds} for that.
 */
export function symbolLeafIds(doc: Document, symbolId: string): string[] {
  const index = sceneIndex(doc);
  return index.shapeIds.filter((id) => index.owner.get(id) === symbolId);
}

/**
 * Paintable leaf ids (shapes and instances) of one editing scope in paint
 * order. A scope is a container node id — the focused container, or a symbol
 * definition's root group while that symbol is being edited — and null for the
 * whole scene (which excludes every definition's content).
 */
export function scopeLeafIds(doc: Document, scope: string | null): string[] {
  const index = sceneIndex(doc);
  if (scope === null)
    return index.shapeIds.filter((id) => index.owner.get(id) === null);
  return index.shapeIds.filter((id) =>
    index.ancestors.get(id)?.includes(scope)
  );
}

/** Top-level node ids of a scope (scene rootIds or the container's children). */
export function scopeRootIds(doc: Document, scope: string | null): string[] {
  if (scope === null) return doc.rootIds;
  return childIdsOfNode(doc.nodes[scope]);
}

/**
 * Whether `nodeId` is editable inside `scope`. Scene scope contains only scene
 * nodes (never symbol-definition content); a focused scope contains only its
 * descendants, not the focus root itself.
 */
export function isNodeInScope(
  doc: Document,
  nodeId: string,
  scope: string | null
): boolean {
  const index = sceneIndex(doc);
  if (!index.parent.has(nodeId)) return false;
  if (scope === null) return index.owner.get(nodeId) === null;
  return index.ancestors.get(nodeId)?.includes(scope) ?? false;
}

/**
 * The symbol whose definition contains `nodeId` (the definition root itself
 * included), or null for scene nodes. Lets scope-aware code that still needs a
 * symbol id — cycle checks, panel highlighting — recover it from a scope.
 */
export function enclosingSymbolId(doc: Document, nodeId: string | null): string | null {
  if (nodeId === null) return null;
  return sceneIndex(doc).owner.get(nodeId) ?? null;
}

function isInvertibleWorldMatrix(doc: Document, nodeId: string): boolean {
  const world = sceneIndex(doc).world.get(nodeId);
  return !!world && Math.abs(world[0] * world[3] - world[1] * world[2]) >= 1e-12;
}

function isDefinitionRootReachedFrom(
  doc: Document,
  outerScope: string,
  nodeId: string
): boolean {
  const symbolId = enclosingSymbolId(doc, nodeId);
  const definition = symbolId ? doc.symbols[symbolId] : undefined;
  if (definition?.rootNodeId !== nodeId) return false;
  return scopeLeafIds(doc, outerScope).some((id) => {
    const node = doc.nodes[id];
    return (
      isInstance(node) &&
      node.symbolId === symbolId &&
      !isNodeHidden(doc, id) &&
      !isNodeLocked(doc, id)
    );
  });
}

/**
 * The longest prefix of a focus stack that is still valid for `doc`: every
 * entry must still be a usable focus root. Ordinary entries sit inside the
 * previous one; a symbol-definition root may instead be reached through an
 * instance inside the previous scope. Undo, redo and file loads can invalidate
 * either kind of edge, so the stack is re-validated against every document the
 * store adopts.
 */
export function validFocusPrefix(doc: Document, stack: string[]): string[] {
  const valid: string[] = [];
  for (const id of stack) {
    if (!isGroup(doc.nodes[id]) && !isFrame(doc.nodes[id])) break;
    if (isNodeHidden(doc, id) || isNodeLocked(doc, id)) break;
    if (!isInvertibleWorldMatrix(doc, id)) break;
    const outer = valid[valid.length - 1];
    if (
      outer !== undefined &&
      !ancestorIds(doc, id).includes(outer) &&
      !isDefinitionRootReachedFrom(doc, outer, id)
    ) break;
    valid.push(id);
  }
  return valid;
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
      else if (isContainer(node)) node.childIds.forEach(walk);
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

/**
 * Generator script ids referenced by the given nodes. Built-in generator ids
 * come through too — callers that need document scripts filter them out.
 */
export function referencedScriptIds(nodes: Iterable<SceneNode>): Set<string> {
  const out = new Set<string>();
  for (const node of nodes) if (node.generator) out.add(node.generator.scriptId);
  return out;
}

/** Ids of instances of `symbolId` anywhere (scene and other definitions). */
export function instanceIdsOf(doc: Document, symbolId: string): string[] {
  return Object.values(doc.nodes)
    .filter((node): node is SymbolInstance => isInstance(node) && node.symbolId === symbolId)
    .map((node) => node.id);
}

/**
 * Instance count per symbol id, in one pass over the scene. Lets the Symbols
 * panel show every row's count without an O(nodes) scan per symbol.
 */
export function instanceCountsBySymbol(doc: Document): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of Object.values(doc.nodes)) {
    if (isInstance(node)) {
      counts.set(node.symbolId, (counts.get(node.symbolId) ?? 0) + 1);
    }
  }
  return counts;
}

/** Top-level frame nodes in document (= export) order. */
export function framesInPaintOrder(doc: Document): FrameNode[] {
  return doc.rootIds
    .map((id) => doc.nodes[id])
    .filter(isFrame);
}

export function parentIdOf(doc: Document, id: string): string | null {
  return sceneIndex(doc).parent.get(id) ?? null;
}

export function childIdsOf(doc: Document, parentId: string | null): string[] {
  if (parentId === null) return doc.rootIds;
  return childIdsOfNode(doc.nodes[parentId]);
}

export function withChildIds(
  doc: Document,
  parentId: string | null,
  childIds: string[]
): Document {
  if (parentId === null) return { ...doc, rootIds: childIds };
  const parent = doc.nodes[parentId];
  if (!isContainer(parent)) return doc;
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
 * The frame a node lives in, or null when it is not inside one. Frames only
 * ever exist at the top level (see docs/document-model.md), so this is just the
 * root ancestor when that happens to be a frame.
 */
export function containingFrameId(doc: Document, id: string): string | null {
  const root = rootAncestorId(doc, id);
  return isFrame(doc.nodes[root]) ? root : null;
}

/**
 * Outermost ancestor of `id` below the nearest selection boundary. Used so a
 * canvas leaf hit resolves to the right selectable unit.
 *
 * Boundaries are the given scope root group (a drilled-into group or a symbol
 * definition root) and — crucially — any **frame**: a frame is an implicit
 * boundary, so content inside a frame resolves to its own outermost ancestor
 * *below* the frame, never to the frame itself (frames are selected via their
 * border or the Layers panel). Frames are top-level, so a drilled group is
 * always the nearer, tighter boundary when both are present.
 */
export function rootAncestorIdWithin(
  doc: Document,
  id: string,
  scopeRootGroup: string | null
): string {
  const chain = ancestorIds(doc, id); // nearest parent → outermost
  for (let i = 0; i < chain.length; i++) {
    if (chain[i] === scopeRootGroup || isFrame(doc.nodes[chain[i]])) {
      return i === 0 ? id : chain[i - 1];
    }
  }
  return chain[chain.length - 1] ?? id;
}

export function descendantNodeIds(doc: Document, id: string): string[] {
  const result: string[] = [];
  const visit = (nodeId: string) => {
    const node = doc.nodes[nodeId];
    if (!isContainer(node)) return;
    for (const childId of node.childIds) {
      result.push(childId);
      visit(childId);
    }
  };
  visit(id);
  return result;
}

export function descendantShapeIds(doc: Document, id: string): string[] {
  const result: string[] = [];
  const visit = (nodeId: string) => {
    const node = doc.nodes[nodeId];
    if (isShape(node)) {
      result.push(nodeId);
      return;
    }
    if (isGroup(node) || isFrame(node)) node.childIds.forEach(visit);
  };
  visit(id);
  return result;
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

const paintAssetId = (paint: Paint | null): string | null =>
  paint && paint.type === "pattern" ? paint.assetId : null;

/**
 * All asset ids a document references: `image` nodes and every pattern
 * fill/stroke (including on compound-path components), plus the patterns held
 * by document variables, symbol parameter defaults and instance args. Drives
 * export pre-decode and save-time orphan pruning so a texture's asset survives
 * even when no image node uses it.
 */
export function referencedAssetIds(doc: Document): Set<string> {
  const out = new Set(assetReferenceCounts(doc).keys());
  for (const entry of Object.values(doc.vars)) {
    const id = varValueAssetId(entry.value);
    if (id) out.add(id);
  }
  for (const def of Object.values(doc.symbols)) {
    for (const param of def.params) {
      const id = varValueAssetId(param.default);
      if (id) out.add(id);
    }
  }
  for (const node of Object.values(doc.nodes)) {
    if (!isInstance(node)) continue;
    for (const value of Object.values(node.args)) {
      const id = varValueAssetId(value);
      if (id) out.add(id);
    }
  }
  return out;
}

/** The asset a variable's paint value points at, if any. */
const varValueAssetId = (value: VarValue): string | null =>
  value.kind === "paint" ? paintAssetId(value.value) : null;

/** The same, for a loose set of nodes (a clipboard payload) rather than a document. */
export function referencedAssetIdsOf(nodes: Iterable<SceneNode>): Set<string> {
  const out = new Set<string>();
  for (const node of nodes) {
    if (isInstance(node)) {
      for (const value of Object.values(node.args)) {
        const id = varValueAssetId(value);
        if (id) out.add(id);
      }
    }
    if (!isShape(node)) continue;
    if (node.type === "image") out.add(node.assetId);
    for (const id of [paintAssetId(node.fill), paintAssetId(node.stroke)]) {
      if (id) out.add(id);
    }
  }
  return out;
}

/**
 * How many shapes reference each asset (image nodes + pattern fill/stroke,
 * recursing into compound-path components). The single source of truth behind
 * {@link referencedAssetIds}; the Assets panel uses the counts directly.
 */
export function assetReferenceCounts(doc: Document): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  const addShape = (shape: Shape) => {
    if (shape.type === "image") bump(shape.assetId);
    for (const id of [paintAssetId(shape.fill), paintAssetId(shape.stroke)]) {
      if (id) bump(id);
    }
  };
  for (const node of Object.values(doc.nodes)) if (isShape(node)) addShape(node);
  return counts;
}

export function isNodeHidden(doc: Document, id: string): boolean {
  return sceneIndex(doc).hidden.get(id) ?? false;
}

export function isNodeLocked(doc: Document, id: string): boolean {
  return sceneIndex(doc).locked.get(id) ?? false;
}
