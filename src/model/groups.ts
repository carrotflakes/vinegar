// Selection/group compatibility helpers backed by the unified scene tree.

import {
  ancestorIds,
  descendantShapeIds,
  isGroup,
  isNodeHidden,
  isNodeLocked,
  isShape,
  parentIdOf,
  rootAncestorId,
  rootAncestorIdWithin,
  selectionRoots,
} from "./scene";
import type { Document, Group, Shape } from "./types";

export function groupChain(doc: Document, nodeId?: string | null): string[] {
  if (!nodeId) return [];
  const node = doc.nodes[nodeId];
  return [
    ...(isGroup(node) ? [nodeId] : []),
    ...ancestorIds(doc, nodeId).filter((id) => isGroup(doc.nodes[id])),
  ];
}

export function rootGroupId(doc: Document, nodeId?: string | null): string | null {
  if (!nodeId) return null;
  const root = rootAncestorId(doc, nodeId);
  return isGroup(doc.nodes[root]) ? root : null;
}

export const shapesInGroup = descendantShapeIds;

export function isShapeHidden(doc: Document, shape: Shape): boolean {
  return isNodeHidden(doc, shape.id);
}

export function isShapeLocked(doc: Document, shape: Shape): boolean {
  return isNodeLocked(doc, shape.id);
}

/**
 * Canvas selection resolves leaf hits to their outermost group. Inside a
 * symbol's local view, "outermost" stops below the definition root group.
 */
export function expandToGroups(
  doc: Document,
  ids: string[],
  scopeRootGroup: string | null = null
): string[] {
  return [
    ...new Set(ids.map((id) => rootAncestorIdWithin(doc, id, scopeRootGroup))),
  ];
}

export function selectionUnits(
  doc: Document,
  selection: string[]
): { groups: Group[]; shapes: Shape[] } {
  const nodes = selectionRoots(doc, selection).map((id) => doc.nodes[id]);
  return {
    groups: nodes.filter(isGroup),
    shapes: nodes.filter(isShape),
  };
}

export function canGroupSelection(doc: Document, selection: string[]): boolean {
  const roots = selectionRoots(doc, selection);
  return (
    roots.length >= 2 &&
    new Set(roots.map((id) => parentIdOf(doc, id))).size === 1
  );
}

export function exactlySelectedGroup(
  doc: Document,
  selection: string[]
): Group | null {
  const roots = selectionRoots(doc, selection);
  if (roots.length !== 1) return null;
  const node = doc.nodes[roots[0]];
  return isGroup(node) ? node : null;
}

/** Empty groups are valid; no implicit pruning occurs in the scene model. */
export function pruneGroups(doc: Document): Document {
  return doc;
}
