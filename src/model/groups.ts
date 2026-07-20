// Selection/group compatibility helpers backed by the unified scene tree.

import {
  ancestorIds,
  isGroup,
  isNodeHidden,
  isNodeLocked,
  isShape,
  parentIdOf,
  rootAncestorIdWithin,
  selectionRoots,
} from "./scene";
import type { Document, Group, Shape } from "./types";

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

/**
 * The group that canvas selection should resolve *below*: the drilled-into
 * active group when it's still a valid group, otherwise the symbol scope's
 * own root group. See {@link expandToGroups}.
 */
export function drillScopeRoot(
  doc: Document,
  activeGroupId: string | null,
  symbolScopeRoot: string | null
): string | null {
  return activeGroupId && isGroup(doc.nodes[activeGroupId])
    ? activeGroupId
    : symbolScopeRoot;
}

/** Whether `id` is the active group or nested inside it. */
export function isWithinGroup(
  doc: Document,
  id: string,
  groupId: string
): boolean {
  return id === groupId || ancestorIds(doc, id).includes(groupId);
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
