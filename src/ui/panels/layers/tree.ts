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

/** Row indent: the padding every row starts at, plus one nesting level. */
export const ROW_PAD = 6;
export const ROW_INDENT = 16;

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

/**
 * The container id a drop can land inside, if this node is one. Groups, frames
 * and compound paths hold children; a symbol instance shows its content but
 * owns none of it, so it is not a target.
 */
export function dropContainerId(node: DNode): string | undefined {
  if (node.group || node.frame) return node.key;
  if (node.shape?.type === "compoundPath") return node.key;
  return undefined;
}

/** Where a pending drop would land, and where its indicator is drawn. */
export interface Drop {
  parent: string | null;
  index: number;
  /** Set when the drop goes *into* a container rather than beside a row. */
  inside?: string;
  /** Flat row index the indicator line is drawn at. */
  line: number;
  /**
   * Indent level the indicator is drawn at — the depth of a row *inside* the
   * drop's parent. It cannot be read off the row at `line`: dropping after a
   * container's last child puts the line on the row that follows the container,
   * which sits at a shallower depth and would draw the indicator outside.
   */
  depth: number;
}

/** One nesting level the gap below a row can close into. */
interface Level {
  parent: string | null;
  index: number;
  depth: number;
}

/**
 * The levels a drop in the gap *below* row `flat` may choose between, deepest
 * first. The gap below the last child of a container is also the gap after that
 * container, and after its container in turn, so every level from the row's own
 * up to the depth the next row returns to is a candidate — which is why the gap
 * needs a horizontal position to disambiguate, list-editor style.
 */
function levelsBelow(rows: Row[], flat: number): Level[] {
  const row = rows[flat];
  if (!row) return [];
  const floor = rows[flat + 1]?.depth ?? 0;
  const levels: Level[] = [{ parent: row.parent, index: row.index + 1, depth: row.depth }];
  const rowAbove = (key: string): Row | undefined => {
    for (let i = flat - 1; i >= 0; i--) {
      const candidate = rows[i];
      if (candidate && candidate.key === key) return candidate;
    }
    return undefined;
  };
  let at = row;
  while (at.depth > floor && at.parent !== null) {
    const parent = rowAbove(at.parent);
    if (!parent) break;
    levels.push({ parent: parent.parent, index: parent.index + 1, depth: parent.depth });
    at = parent;
  }
  return levels;
}

/**
 * The drop a pointer resting over one row means. Kept pure so the geometry
 * (which third of the row, which indent) is testable without a DOM: the hook
 * only feeds it the row under the pointer and the position within it.
 *
 * The middle of a container row drops *into* it; above or below the middle
 * drops beside the row. `canDropInto` rejects a container the drag may not
 * enter (itself, or its own subtree), and a rejected level falls back to a
 * shallower one — dragging a container out of itself is exactly the case where
 * the deep levels are all illegal and the level above it is what was meant.
 */
export function dropTargetAt(opts: {
  rows: Row[];
  collapsed: Set<string>;
  /** Flat index of the row under the pointer. */
  flat: number;
  /** Vertical position within that row: 0 at its top edge, 1 at its bottom. */
  ratio: number;
  /** Horizontal position within the row, in px from its left edge. */
  x: number;
  canDropInto: (containerId: string) => boolean;
}): Drop | null {
  const { rows, collapsed, flat, ratio, x, canDropInto } = opts;
  const row = rows[flat];
  if (!row) return null;

  // A container's middle band drops inside it. An expanded one has no "after"
  // band at all: the gap below its row is the head of its own child list, and
  // the row after its last child is where dropping past it is aimed.
  const inside = dropContainerId(row.node);
  const expanded = inside !== undefined && !collapsed.has(inside);
  if (inside && ratio > 0.28 && (expanded || ratio < 0.72) && canDropInto(inside)) {
    return { parent: inside, index: 0, inside, line: flat + 1, depth: row.depth + 1 };
  }

  if (ratio < 0.5) {
    if (row.parent !== null && !canDropInto(row.parent)) return null;
    return { parent: row.parent, index: row.index, line: flat, depth: row.depth };
  }

  const levels = levelsBelow(rows, flat);
  // Which level the pointer's indent asks for; the list is deepest first.
  const wanted = Math.round((x - ROW_PAD) / ROW_INDENT);
  const from = Math.max(0, Math.min(row.depth - wanted, levels.length - 1));
  const level = levels
    .slice(from)
    .find((l) => l.parent === null || canDropInto(l.parent));
  if (!level) return null;
  return { parent: level.parent, index: level.index, line: flat + 1, depth: level.depth };
}
