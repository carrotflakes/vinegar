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

/**
 * Every row that can be folded, in display order: the containers with at least
 * one child. An empty container has no fold state (its chevron is not drawn),
 * so collapsing it would leave an id in the set that no row ever matches.
 */
export function containerIds(nodes: DNode[]): string[] {
  return nodes.flatMap((n) =>
    n.children && n.children.length > 0
      ? [n.key, ...containerIds(n.children)]
      : []
  );
}

/** All descendant shape ids, in display order. */
export function shapeIds(nodes: DNode[]): string[] {
  return nodes.flatMap((n) => (n.children ? shapeIds(n.children) : [n.key]));
}

/** One rendered row: a display node plus everything the row needs to draw. */
export interface Row {
  key: string;
  node: DNode;
  /** Indent level. */
  depth: number;
  /** The row's container (`null` = panel root) and its slot within it. */
  parent: string | null;
  index: number;
  /** Inside a hidden ancestor, so the row is drawn dimmed. */
  dim: boolean;
}

/**
 * The tree flattened into the rows the panel actually shows, top to bottom.
 * `collapsed` hides a container's children; pass an empty set for every row in
 * the tree. Flat rows are what makes windowed scrolling possible — the panel
 * renders a slice of this list, and every index in it is a pixel offset.
 */
export function flattenRows(nodes: DNode[], collapsed: Set<string>): Row[] {
  const out: Row[] = [];
  const walk = (
    ns: DNode[],
    parent: string | null,
    depth: number,
    dim: boolean
  ) => {
    ns.forEach((node, index) => {
      out.push({ key: node.key, node, depth, parent, index, dim });
      if (node.children && !collapsed.has(node.key)) {
        const self = (node.group ?? node.frame ?? node.instance ?? node.shape)!;
        walk(node.children, node.key, depth + 1, dim || !!self.hidden);
      }
    });
  };
  walk(nodes, null, 0, false);
  return out;
}

/** Row ids top to bottom — the order Shift ranges over. */
export function visibleIds(nodes: DNode[], collapsed: Set<string>): string[] {
  return flattenRows(nodes, collapsed).map((row) => row.key);
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
