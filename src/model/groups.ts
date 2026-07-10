// ===========================================================================
// Group-tree helpers. Groups are flat records (`doc.groups`) linked by
// `parentId`; shapes point at their immediate group via `groupId`. Chains are
// walked with a visited-guard so a malformed (cyclic) file can't hang us.
// ===========================================================================

import type { Document, Group, Shape } from "./types";

/** Ancestor group ids of a shape/group, immediate first. */
export function groupChain(
  doc: Document,
  groupId: string | null | undefined
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let gid = groupId ?? null;
  while (gid && doc.groups[gid] && !seen.has(gid)) {
    seen.add(gid);
    chain.push(gid);
    gid = doc.groups[gid].parentId ?? null;
  }
  return chain;
}

/** Outermost group id containing `groupId`, or null when ungrouped. */
export function rootGroupId(
  doc: Document,
  groupId: string | null | undefined
): string | null {
  const chain = groupChain(doc, groupId);
  return chain.length > 0 ? chain[chain.length - 1] : null;
}

/** All shape ids inside `gid` (any depth), in document order. */
export function shapesInGroup(doc: Document, gid: string): string[] {
  return doc.order.filter((id) =>
    groupChain(doc, doc.shapes[id]?.groupId).includes(gid)
  );
}

/** Whether the shape or any enclosing group is hidden. */
export function isShapeHidden(doc: Document, shape: Shape): boolean {
  if (shape.hidden) return true;
  return groupChain(doc, shape.groupId).some((gid) => doc.groups[gid].hidden);
}

/** Whether the shape or any enclosing group is locked. */
export function isShapeLocked(doc: Document, shape: Shape): boolean {
  if (shape.locked) return true;
  return groupChain(doc, shape.groupId).some((gid) => doc.groups[gid].locked);
}

/**
 * Expand shape ids so whole top-level groups are always selected together
 * (canvas-level selection granularity).
 */
export function expandToGroups(doc: Document, ids: string[]): string[] {
  const roots = new Set<string>();
  for (const id of ids) {
    const root = rootGroupId(doc, doc.shapes[id]?.groupId);
    if (root) roots.add(root);
  }
  if (roots.size === 0) return ids;
  const result = new Set(ids);
  for (const oid of doc.order) {
    const root = rootGroupId(doc, doc.shapes[oid]?.groupId);
    if (root && roots.has(root)) result.add(oid);
  }
  return [...result];
}

/**
 * Decompose a selection into its top-level fully-selected units: the maximal
 * groups whose every member shape is selected, plus the selected shapes not
 * covered by any of those groups. This is what group/ungroup and the
 * properties panel reason about.
 */
export function selectionUnits(
  doc: Document,
  selection: string[]
): { groups: Group[]; shapes: Shape[] } {
  const sel = new Set(selection);
  // Candidate groups: every ancestor of a selected shape.
  const candidates = new Set<string>();
  for (const id of selection) {
    for (const gid of groupChain(doc, doc.shapes[id]?.groupId)) {
      candidates.add(gid);
    }
  }
  const fully = new Set(
    [...candidates].filter((gid) =>
      shapesInGroup(doc, gid).every((id) => sel.has(id))
    )
  );
  // Maximal = fully-selected groups whose parent chain has no fully-selected
  // group above them.
  const groups = [...fully]
    .filter(
      (gid) =>
        !groupChain(doc, doc.groups[gid].parentId ?? null).some((a) =>
          fully.has(a)
        )
    )
    .map((gid) => doc.groups[gid]);
  const covered = new Set(groups.flatMap((g) => shapesInGroup(doc, g.id)));
  const shapes = selection
    .filter((id) => !covered.has(id))
    .map((id) => doc.shapes[id])
    .filter(Boolean) as Shape[];
  return { groups, shapes };
}

/**
 * Whether the selection can be grouped: at least two top-level units, all
 * sharing one parent container (so the new group nests cleanly).
 */
export function canGroupSelection(
  doc: Document,
  selection: string[]
): boolean {
  const units = selectionUnits(doc, selection);
  if (units.groups.length + units.shapes.length < 2) return false;
  const parents = new Set<string | null>([
    ...units.groups.map((g) => g.parentId ?? null),
    ...units.shapes.map((s) => s.groupId ?? null),
  ]);
  return parents.size === 1;
}

/**
 * The single (outermost) group the selection exactly covers, if any. Used to
 * surface group properties in the UI.
 */
export function exactlySelectedGroup(
  doc: Document,
  selection: string[]
): Group | null {
  const { groups, shapes } = selectionUnits(doc, selection);
  if (shapes.length > 0 || groups.length !== 1) return null;
  return groups[0];
}

/**
 * Drop groups that no longer contain any shape (recursively) and clear
 * dangling group references. Returns the same doc when nothing changed.
 */
export function pruneGroups(doc: Document): Document {
  const used = new Set<string>();
  let dangling = false;
  for (const id of doc.order) {
    const s = doc.shapes[id];
    if (!s?.groupId) continue;
    const chain = groupChain(doc, s.groupId);
    if (chain.length === 0) dangling = true;
    for (const gid of chain) used.add(gid);
  }
  const stale = Object.keys(doc.groups).filter((gid) => !used.has(gid));
  if (stale.length === 0 && !dangling) return doc;

  const groups: Record<string, Group> = {};
  for (const gid of used) {
    const g = doc.groups[gid];
    const parentOk = g.parentId && used.has(g.parentId);
    groups[gid] = parentOk ? g : { ...g, parentId: null };
  }
  const shapes = { ...doc.shapes };
  for (const id of doc.order) {
    const s = shapes[id];
    if (s?.groupId && !groups[s.groupId]) {
      shapes[id] = { ...s, groupId: null };
    }
  }
  return { ...doc, shapes, groups };
}
