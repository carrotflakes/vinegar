// Row drag-and-drop for the Layers panel: what a drag carries, where the drop
// line lands, edge auto-scrolling, and the reparent that commits it. Follows
// docs/drag-and-drop.md — pointer events via useTouchDrag, never HTML5 DnD.

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { Document } from "@/model/types";
import { ancestorIds, selectionRoots } from "@/model/scene";
import { useTouchDrag } from "../../useTouchDrag";
import {
  childrenOf,
  dropChildIndex,
  dropTargetAt,
  visibleIds,
  type DNode,
  type Drop,
  type Row,
} from "./tree";

/** The rows a drag carries, top-most first. */
interface Drag {
  ids: string[];
}

/**
 * A row's own swipe callbacks. The swipe opens that row's context menu, whose
 * entries only the row knows how to build, so the row hands them to the gesture
 * rather than the panel routing the swipe back down.
 */
export interface RowSwipe {
  /** Live rightward offset, 0 once the gesture ends. */
  onMove: (dx: number) => void;
  /** Released past the trigger distance, at the release point. */
  onOpen: (x: number, y: number) => void;
}

/** What one row's pointer gesture carries: a drag payload plus its swipe. */
interface RowGesture {
  ids: string[];
  swipe: RowSwipe;
}

/**
 * The one data attribute a row carries: its flat index. Everything else the
 * drop needs (its container, slot, depth, whether it accepts a drop inside) is
 * `rows[flat]`, which the hook already has — mirroring it into the DOM would be
 * a second copy of the tree to keep in step.
 */
export interface RowDndProps {
  "data-row-flat": number;
  onPointerDown: ((e: PointerEvent) => void) | undefined;
}

interface Options {
  doc: Document;
  roots: DNode[];
  rows: Row[];
  collapsed: Set<string>;
  selection: string[];
  /** The row being renamed, if any — its input owns the pointer. */
  editing: string | null;
  /** Where a drop at the panel root lands (the focused container, or null). */
  scopeParent: string | null;
  scrollerRef: RefObject<HTMLElement | null>;
  moveNodes: (ids: string[], parent: string | null, index: number) => void;
}

export interface LayersDnd {
  dragging: boolean;
  drop: Drop | null;
  rowDnd: (row: Row, flat: number, swipe: RowSwipe) => RowDndProps;
}

export function useLayersDnd({
  doc,
  roots,
  rows,
  collapsed,
  selection,
  editing,
  scopeParent,
  scrollerRef,
  moveNodes,
}: Options): LayersDnd {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  const clearDnd = () => {
    setDrag(null);
    setDrop(null);
  };

  /**
   * The rows a drag carries: the whole selection when the grabbed row is part
   * of it (normalised to roots — a group brings its children along anyway),
   * otherwise just that row. Ordered top-most first, ignoring collapse, so a
   * selected row hidden inside a collapsed container still travels with it.
   */
  const draggedIds = (id: string): string[] => {
    if (!selection.includes(id)) return [id];
    const carried = new Set(selectionRoots(doc, selection));
    return visibleIds(roots, new Set()).filter((key) => carried.has(key));
  };

  /** A node can never be dropped into itself or into its own subtree. */
  const canDropInto = (ids: string[], targetId: string): boolean =>
    !ids.some(
      (id) => id === targetId || ancestorIds(doc, targetId).includes(id)
    );

  const commitDrop = () => {
    const d = drag;
    const t = drop;
    clearDnd();
    if (!d || !t) return;
    const siblings = childrenOf(roots, t.parent);
    if (!siblings) return;
    const index = dropChildIndex(siblings.map((n) => n.key), d.ids, t.index);
    // The panel lists front-most first; child arrays run back to front.
    moveNodes([...d.ids].reverse(), t.parent ?? scopeParent, index);
  };

  // A windowed list can be taller than anything the pointer can reach, so a
  // drag near either edge scrolls it. The speed is sampled on pointermove but
  // applied on a timer, so holding still at the edge keeps scrolling.
  const edgeSpeed = useRef(0);
  const edgeTimer = useRef<number | null>(null);

  const edgeScrollSpeed = (y: number): number => {
    const el = scrollerRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const edge = 28;
    if (y < r.top + edge) return -Math.max(4, (r.top + edge - y) / 2);
    if (y > r.bottom - edge) return Math.max(4, (y - (r.bottom - edge)) / 2);
    return 0;
  };

  const startEdgeScroll = () => {
    if (edgeTimer.current !== null) return;
    edgeTimer.current = window.setInterval(() => {
      if (edgeSpeed.current !== 0 && scrollerRef.current) {
        scrollerRef.current.scrollTop += edgeSpeed.current;
      }
    }, 16);
  };

  const stopEdgeScroll = () => {
    if (edgeTimer.current !== null) window.clearInterval(edgeTimer.current);
    edgeTimer.current = null;
    edgeSpeed.current = 0;
  };

  useEffect(() => stopEdgeScroll, []);

  // Pointer-based row drag (mouse + touch). Touch begins on a long-press so a
  // quick swipe still scrolls the list, and a rightward swipe opens the row's
  // context menu — touch has no right-click and long-press is spoken for. The
  // row under the pointer is hit-tested from its `data-row-flat`; what a drop
  // there means is `dropTargetAt` in tree.ts.
  const startRowDrag = useTouchDrag<RowGesture>({
    onSwipeMove: (d, dx) => d.swipe.onMove(dx),
    onSwipe: (d, p) => d.swipe.onOpen(p.x, p.y),
    onStart: (d) => {
      setDrag({ ids: d.ids });
      startEdgeScroll();
    },
    onMove: (d, { x, y, target }) => {
      edgeSpeed.current = edgeScrollSpeed(y);
      const rowEl = target?.closest<HTMLElement>("[data-row-flat]");
      if (rowEl) {
        const r = rowEl.getBoundingClientRect();
        setDrop(
          dropTargetAt({
            rows,
            collapsed,
            flat: Number(rowEl.dataset.rowFlat),
            ratio: (y - r.top) / r.height,
            x: x - r.left,
            canDropInto: (containerId) => canDropInto(d.ids, containerId),
          })
        );
        return;
      }
      if (target?.closest(".layers-list")) {
        setDrop({ parent: null, index: roots.length, line: rows.length, depth: 0 });
        return;
      }
      setDrop(null);
    },
    onDrop: () => {
      stopEdgeScroll();
      commitDrop();
    },
    onCancel: () => {
      stopEdgeScroll();
      clearDnd();
    },
  });

  return {
    dragging: drag !== null,
    drop,
    rowDnd: (row, flat, swipe) => ({
      "data-row-flat": flat,
      onPointerDown:
        editing === row.key
          ? undefined
          : (e: PointerEvent) =>
              startRowDrag(e, { ids: draggedIds(row.key), swipe }),
    }),
  };
}
