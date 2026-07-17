import {
  ancestorIds,
  childIdsOf,
  isGroup,
  isNodeHidden,
  parentIdOf,
  selectionRoots,
} from "./scene";
import type {
  BezierShape,
  CompoundPathShape,
  Document,
  EllipseShape,
  Group,
  PathShape,
  PolygonShape,
  RectShape,
  SceneNode,
  Shape,
} from "./types";

/** Shapes whose closed geometry can define a vector clipping mask. */
export type ClippingMaskShape =
  | RectShape
  | EllipseShape
  | PathShape
  | BezierShape
  | PolygonShape
  | CompoundPathShape;

/** Whether a node has area-bearing geometry suitable for clipping. Open paths
 * qualify because clipping implicitly closes them, just like fill. */
export function isClippingMaskCandidate(
  node: SceneNode | null | undefined
): node is ClippingMaskShape {
  if (!node) return false;
  switch (node.type) {
    case "rect":
    case "ellipse":
      return node.width !== 0 && node.height !== 0;
    case "polygon":
      return node.polys.some((poly) => poly.some((ring) => ring.length >= 3));
    case "compoundPath":
      return (
        node.components.length > 0 &&
        node.components.every((component) => isClippingMaskCandidate(component))
      );
    case "path":
      return node.points.length >= 3;
    case "bezier":
      return (
        node.subpaths.length > 0 &&
        node.subpaths.every((subpath) => subpath.anchors.length >= 2)
      );
    case "line":
    case "image":
    case "text":
    case "brush":
    case "group":
    case "instance":
      return false;
  }
}

/** Whether a scene node is explicitly marked as a clipping group. */
export function isClippingGroup(
  node: SceneNode | null | undefined
): node is Group & { clip: true } {
  return node?.type === "group" && node.clip === true;
}

/**
 * The frontmost child used by a clipping group, or null for an ordinary or
 * malformed group. A clipping group must retain at least one content child in
 * addition to its mask.
 */
export function clippingMask(
  doc: Document,
  group: Group
): ClippingMaskShape | null {
  if (!isClippingGroup(group) || group.childIds.length < 2) return null;
  const node = doc.nodes[group.childIds[group.childIds.length - 1]];
  return isClippingMaskCandidate(node) ? node : null;
}

/** Child ids painted beneath a group's mask; ordinary groups return all ids. */
export function clippingContentIds(doc: Document, group: Group): string[] {
  return clippingMask(doc, group)
    ? group.childIds.slice(0, -1)
    : group.childIds;
}

/** Fill rule used by the shared Canvas, SVG, and hit-test mask geometry. */
export function shapeFillRule(shape: Shape): "nonzero" | "evenodd" {
  return shape.type === "polygon" || shape.type === "compoundPath"
    ? "evenodd"
    : "nonzero";
}

/**
 * Whether this group preserves the clipping invariant. Ordinary groups are
 * valid; clipping groups require content plus a valid frontmost mask.
 */
export function isValidClippingMaskGroup(
  doc: Document,
  group: Group
): boolean {
  return !isClippingGroup(group) || clippingMask(doc, group) !== null;
}

/** Whether every clipping group in the document preserves its mask invariant. */
export function hasValidClippingMasks(doc: Document): boolean {
  return Object.values(doc.nodes).every(
    (node) => !isGroup(node) || isValidClippingMaskGroup(doc, node)
  );
}

/** Whether a node is the active frontmost mask of its parent clipping group. */
export function isClippingMaskNode(doc: Document, nodeId: string): boolean {
  const parentId = parentIdOf(doc, nodeId);
  if (parentId === null) return false;
  const parent = doc.nodes[parentId];
  return isGroup(parent) && clippingMask(doc, parent)?.id === nodeId;
}

/**
 * Whether a leaf participates in hit testing. A mask's own hidden flag does
 * not hide its geometry, but a hidden ancestor still suppresses it.
 */
export function isNodeVisibleForHitTesting(
  doc: Document,
  nodeId: string
): boolean {
  if (!isClippingMaskNode(doc, nodeId)) return !isNodeHidden(doc, nodeId);
  return !ancestorIds(doc, nodeId).some((id) => !!doc.nodes[id]?.hidden);
}

/** Active clipping masks enclosing a node, nearest ancestor first. */
export function clippingMaskAncestors(
  doc: Document,
  nodeId: string
): ClippingMaskShape[] {
  const result: ClippingMaskShape[] = [];
  for (const ancestorId of ancestorIds(doc, nodeId)) {
    const ancestor = doc.nodes[ancestorId];
    if (!isGroup(ancestor)) continue;
    const mask = clippingMask(doc, ancestor);
    if (mask) result.push(mask);
  }
  return result;
}

/** Whether the current selection can be wrapped in a new clipping group. */
export function canMakeClippingMaskSelection(
  doc: Document,
  selection: string[]
): boolean {
  const roots = selectionRoots(doc, selection);
  if (roots.length < 2) return false;
  const parentId = parentIdOf(doc, roots[0]);
  if (!roots.every((id) => parentIdOf(doc, id) === parentId)) return false;

  const siblings = childIdsOf(doc, parentId);
  const selected = new Set(roots);
  const ordered = siblings.filter((id) => selected.has(id));
  if (ordered.length !== roots.length) return false;
  if (!isClippingMaskCandidate(doc.nodes[ordered[ordered.length - 1]])) {
    return false;
  }

  // Replacing an existing clipping group's mask with a nested group would
  // leave that parent without an area-bearing final child.
  const parent = parentId === null ? undefined : doc.nodes[parentId];
  const parentMask = isGroup(parent) ? clippingMask(doc, parent) : null;
  return !parentMask || !selected.has(parentMask.id);
}

/** Whether all selected roots are valid clipping groups that can be released. */
export function canReleaseClippingMaskSelection(
  doc: Document,
  selection: string[]
): boolean {
  const roots = selectionRoots(doc, selection);
  return (
    roots.length > 0 &&
    roots.every((id) => {
      const node = doc.nodes[id];
      return isGroup(node) && isClippingGroup(node) && clippingMask(doc, node) !== null;
    })
  );
}
