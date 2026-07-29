// The Layers panel's display tree and the pure list arithmetic around it:
// range selection and where a drop lands. Kept out of the component so it can
// be tested directly (tests/layersTree.test.mjs) — the panel itself only wires
// these to events.

import {
  isCompoundPath,
  isFrame,
  isGroup,
  isInstance,
  isNodeHidden,
  isNodeLocked,
  isShape,
  selectionRoots,
} from "@/model/scene";
import type { Document, FrameNode, Group, Shape, SymbolInstance } from "@/model/types";

/** Display node: the render tree with every level front-most first. */
export interface DNode {
  key: string;
  shape?: Shape;
  group?: Group;
  frame?: FrameNode;
  instance?: SymbolInstance;
  children?: DNode[] | undefined;
}

export function toDisplayTree(doc: Document, ids: string[]): DNode[] {
  const result: DNode[] = [];
  for (const id of ids) {
    const node = doc.nodes[id];
    if (isGroup(node)) result.push({ key: id, group: node, children: toDisplayTree(doc, node.childIds) });
    else if (isFrame(node)) result.push({ key: id, frame: node, children: toDisplayTree(doc, node.childIds) });
    else if (isInstance(node)) result.push({ key: id, instance: node });
    else if (isShape(node)) {
      result.push({
        key: id,
        shape: node,
        children: isCompoundPath(node)
          ? toDisplayTree(doc, node.childIds)
          : undefined,
      });
    }
  }
  return result.reverse();
}

/** All descendant shape ids, in display order. */
export function shapeIds(nodes: DNode[]): string[] {
  return nodes.flatMap((n) => (n.children ? shapeIds(n.children) : [n.key]));
}

/**
 * Rows top to bottom — the order Shift ranges over. `collapsed` hides a
 * container's children; pass an empty set for every row in the tree.
 */
export function visibleIds(nodes: DNode[], collapsed: Set<string>): string[] {
  const out: string[] = [];
  const walk = (ns: DNode[]) => {
    for (const n of ns) {
      out.push(n.key);
      if (n.children && !collapsed.has(n.key)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** The children array of a container (`null` = root). */
export function childrenOf(roots: DNode[], parent: string | null): DNode[] | null {
  if (parent === null) return roots;
  for (const n of roots) {
    if (!n.children) continue;
    if (n.key === parent) return n.children;
    const found = childrenOf(n.children, parent);
    if (found) return found;
  }
  return null;
}

/**
 * The selection a Shift+click produces: every row between the two endpoints in
 * `order`, minus what cannot be acted on. Locked and hidden rows are skipped
 * (they are not selectable elsewhere either), and `selectionRoots` drops rows
 * whose container is in the range too — selecting a group *and* its children
 * means nothing downstream. `null` when either endpoint is not in `order`.
 */
export function rangeIds(
  doc: Document,
  order: string[],
  from: string,
  to: string
): string[] | null {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return null;
  const range = order
    .slice(Math.min(a, b), Math.max(a, b) + 1)
    .filter((id) => !isNodeLocked(doc, id) && !isNodeHidden(doc, id));
  return selectionRoots(doc, range);
}

/**
 * Canonical child index for a drop. `siblingKeys` are the target container's
 * children in display order (front-most first) and `index` is the display slot
 * the drop line sits at; dragged rows already in that container vacate their
 * slots first. Canonical order is back-to-front, hence the flip.
 */
export function dropChildIndex(
  siblingKeys: string[],
  dragIds: string[],
  index: number
): number {
  const dragged = new Set(dragIds);
  const remaining = siblingKeys.filter((key) => !dragged.has(key));
  const vacatedAbove = siblingKeys
    .slice(0, index)
    .filter((key) => dragged.has(key)).length;
  const at = Math.max(0, Math.min(index - vacatedAbove, remaining.length));
  return remaining.length - at;
}
