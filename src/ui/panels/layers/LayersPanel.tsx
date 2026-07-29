import { Fragment, useEffect, useRef, useState, type ComponentType } from "react";
import {
  LuSquare,
  LuCircle,
  LuSlash,
  LuWaves,
  LuImage,
  LuEye,
  LuEyeOff,
  LuLock,
  LuLockOpen,
  LuChevronRight,
  LuChevronDown,
  LuChevronLeft,
  LuCombine,
  LuComponent,
  LuType,
  LuBrush,
  LuFrame,
} from "react-icons/lu";
import type { Shape } from "../../../model/types";
import { isClippingGroup, isClippingMaskNode } from "../../../model/clippingMask";
import {
  ancestorIds,
  childIdsOfNode,
  scopeRootGroupId,
  scopeRootIds,
  selectionRoots,
} from "../../../model/scene";
import {
  childrenOf,
  dropChildIndex,
  flattenRows,
  rangeIds,
  shapeIds,
  toDisplayTree,
  visibleIds,
  type Row,
} from "./tree";
import { isMac } from "../../../commands/registry";
import { currentSymbolScope, useEditor } from "../../../store/editorStore";
import { useHighlight } from "../../../store/highlightStore";
import { useLayersView } from "../../../store/layersViewStore";
import { readModifiers } from "../../../store/inputStore";
import { openContextMenu } from "../../../store/menuStore";
import { selectionMenu } from "../../menus";
import { useTouchDrag } from "../../useTouchDrag";
import "../../Panel.css";
import "../PanelList.css";

const TYPE_ICON: Record<Shape["type"], ComponentType> = {
  rect: LuSquare,
  ellipse: LuCircle,
  line: LuSlash,
  path: LuWaves,
  compoundPath: LuCombine,
  image: LuImage,
  text: LuType,
  brush: LuBrush,
};

const stateButtonClass = (isSet: boolean) =>
  `layer-icon-btn layer-state-btn ${isSet ? "state-set" : "state-idle"}`;

// Rows are uniform in height, so the list only renders the slice around the
// viewport once there are enough of them for it to matter (an SVG import can
// land thousands). Below that everything renders, which keeps small documents
// on the simple path and away from any measurement edge case.
const VIRTUALIZE_FROM = 100;
const OVERSCAN = 8;

/**
 * The element that actually scrolls the panel. Depending on the dock layout
 * that is either the list itself or an ancestor (the dock body stacks several
 * panels and scrolls them together), so the window is measured against
 * whichever one is really clipping — never assumed.
 */
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  for (let p: HTMLElement | null = el; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (p.scrollHeight > p.clientHeight + 1) return p;
    fallback ??= p;
  }
  return fallback;
}

/** The rows a drag carries, top-most first. */
interface Drag {
  ids: string[];
}

interface Drop {
  parent: string | null;
  index: number;
  inside?: string;
  /** Flat row index the indicator line is drawn at. */
  line: number;
}

export default function LayersPanel() {
  // Freeze the tree during a canvas drag: `_interaction.before` is the stable
  // pre-drag document, so this selector keeps returning the same reference while
  // a move/resize/etc. is live. The panel only shows structure (which a drag
  // never changes), so it stays correct and skips re-rendering thousands of rows
  // every frame; it repaints once when the interaction commits.
  const doc = useEditor((s) => s._interaction?.before ?? s.doc);
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const toggleLocked = useEditor((s) => s.toggleLocked);
  const renameNode = useEditor((s) => s.renameNode);
  const moveNodes = useEditor((s) => s.moveNodes);
  const scope = useEditor((s) => currentSymbolScope(s));
  const exitSymbolEdit = useEditor((s) => s.exitSymbolEdit);
  const enterSymbolEdit = useEditor((s) => s.enterSymbolEdit);
  const detachSelectedInstances = useEditor((s) => s.detachSelectedInstances);

  const setHighlight = useHighlight((s) => s.setHighlight);
  const clearHighlight = useHighlight((s) => s.clearHighlight);

  // A row can disappear without a pointerleave (collapse, delete, panel close),
  // so the highlight is dropped when the panel goes away too.
  useEffect(() => () => useHighlight.getState().setHighlight(null), []);

  const [editing, setEditing] = useState<string | null>(null);
  // Folds outlive the component: the dock unmounts the panel whenever another
  // tab in its group is shown, so this state lives in a store.
  const collapsed = useLayersView((s) => s.collapsed);
  const toggleCollapsed = useLayersView((s) => s.toggleCollapsed);
  const expandContainers = useLayersView((s) => s.expand);
  // Range selection keeps two marks, like any list: `anchor` is where a range
  // starts and `cursor` is the row the keyboard sits on / the last one clicked.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [rowHeight, setRowHeight] = useState(0);
  const [windowBox, setWindowBox] = useState({ top: 0, height: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  // In a symbol's local view the panel shows that definition's tree; a drop
  // at the panel root then targets the definition root group, not the scene.
  const scopeParent = scopeRootGroupId(doc, scope);
  const roots = toDisplayTree(doc, scopeRootIds(doc, scope));
  const rows = flattenRows(roots, collapsed);

  /** The visible slice of the rows box, in pixels from its top. */
  const measureWindow = () => {
    const box = rowsRef.current;
    const scroller = scrollParentOf(listRef.current);
    scrollerRef.current = scroller;
    if (!box || !scroller) return;
    const r = box.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const next = { top: s.top - r.top, height: s.height };
    setWindowBox((prev) =>
      prev.top === next.top && prev.height === next.height ? prev : next
    );
  };

  // Windowing needs one number the DOM owns: how tall a row is. Measuring the
  // first rendered row keeps it in step with the stylesheet instead of pinning
  // a magic constant that a padding change would silently break. Both this and
  // the window run after every render — the panel's own layout can move under
  // a collapse, a rename or a dock resize just as much as under a scroll.
  useEffect(() => {
    const el = listRef.current?.querySelector(".layer-row");
    const h = el?.getBoundingClientRect().height ?? 0;
    if (h > 0 && h !== rowHeight) setRowHeight(h);
    measureWindow();
  });

  // Scroll events do not bubble, and which element scrolls depends on the dock
  // layout, so listen on the capture phase and re-measure.
  useEffect(() => {
    const onScroll = () => measureWindow();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const windowed =
    rowHeight > 0 && windowBox.height > 0 && rows.length > VIRTUALIZE_FROM;
  const first = windowed
    ? Math.max(0, Math.floor(windowBox.top / rowHeight) - OVERSCAN)
    : 0;
  const last = windowed
    ? Math.min(
        rows.length,
        Math.ceil((windowBox.top + windowBox.height) / rowHeight) + OVERSCAN
      )
    : rows.length;

  const selectIds = (ids: string[], additive: boolean) => {
    if (additive) {
      const has = ids.every((id) => selection.includes(id));
      setSelection(
        has
          ? selection.filter((s) => !ids.includes(s))
          : [...new Set([...selection, ...ids])]
      );
    } else {
      setSelection(ids);
    }
    setAnchor(ids[ids.length - 1] ?? null);
    setCursor(ids[ids.length - 1] ?? null);
  };

  /**
   * Where a range starts. The anchor goes stale when the selection last changed
   * elsewhere (canvas, a command) or when its row left the tree; the newest
   * selected row is then the closest thing to "where the user last was".
   */
  const rangeStart = (): string | null =>
    anchor && selection.includes(anchor)
      ? anchor
      : selection[selection.length - 1] ?? anchor;

  /**
   * List conventions (Finder/Photoshop/Figma): Shift extends a contiguous range
   * from the last clicked row, Ctrl/Cmd toggles one row. A range can straddle
   * nesting levels, so `selectionRoots` drops any row whose container is also in
   * the range — selecting a group *and* its children means nothing downstream.
   *
   * Shift comes from `readModifiers`, so the on-screen Shift toggle counts as
   * well: that is the only way to reach a range on touch, where every gesture a
   * row could use is already spoken for (tap selects, long-press drags, swipe
   * scrolls, double-tap renames). See canvas/ModifierBar.tsx.
   */
  const rowClick = (id: string, e: React.MouseEvent) => {
    const { shift } = readModifiers(e);
    const from = rangeStart();
    if (shift && from && from !== id) {
      const range = rangeIds(doc, visibleIds(roots, collapsed), from, id);
      if (range) {
        setSelection(range);
        setCursor(id); // the anchor stays put, so Shift+click re-extends from it
        return;
      }
    }
    // Ctrl+click is the macOS secondary click, so there Cmd alone toggles.
    selectIds([id], shift || e.metaKey || (!isMac && e.ctrlKey));
  };

  /**
   * Arrow-key row navigation, for the focused list only (the canvas keeps its
   * own keys). Plain moves the cursor and selects that row; Shift extends the
   * range from the anchor, exactly like Shift+click. Left/Right fold and unfold
   * the container under the cursor so a collapsed subtree stays reachable.
   */
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (editing !== null) return; // a rename input owns the keyboard
    const order = visibleIds(roots, collapsed);
    const at = cursor ?? rangeStart();
    const index = at ? order.indexOf(at) : -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        order[
          index < 0
            ? e.key === "ArrowDown" ? 0 : order.length - 1
            : Math.max(0, Math.min(order.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))
        ];
      if (!next) return;
      const from = e.shiftKey ? rangeStart() : null;
      const range = from ? rangeIds(doc, order, from, next) : null;
      if (range) setSelection(range);
      else selectIds([next], false);
      setCursor(next);
      setReveal(next);
      return;
    }
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && at) {
      const isCollapsed = collapsed.has(at);
      if (e.key === "ArrowRight" ? isCollapsed : !isCollapsed) {
        // Rows without children have no fold state to toggle.
        const node = doc.nodes[at];
        if (node && childIdsOfNode(node).length > 0) {
          e.preventDefault();
          toggleCollapsed(at);
        }
      }
    }
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

  // Whatever was selected last should be visible: unfold the containers hiding
  // it, then scroll it into view. `nearest` keeps an already-visible row still,
  // so a click inside the panel never scrolls under the pointer. Runs again
  // after an unfold, because the row only exists once its ancestors are open.
  useEffect(() => {
    if (!reveal) return;
    const hidden = ancestorIds(doc, reveal).filter((a) => collapsed.has(a));
    if (hidden.length > 0) {
      expandContainers(hidden);
      return;
    }
    // Index arithmetic rather than scrollIntoView: with windowing the row may
    // not be in the DOM at all. Only scrolls when the row is out of view, so a
    // click inside the panel never scrolls under the pointer.
    const scroller = scrollerRef.current;
    const box = rowsRef.current;
    const index = rows.findIndex((row) => row.key === reveal);
    if (scroller && box && rowHeight > 0 && index >= 0) {
      const top = box.getBoundingClientRect().top + index * rowHeight;
      const view = scroller.getBoundingClientRect();
      if (top < view.top) scroller.scrollTop += top - view.top;
      else if (top + rowHeight > view.bottom) {
        scroller.scrollTop += top + rowHeight - view.bottom;
      }
    }
    setReveal(null);
  }, [reveal, collapsed, doc, rowHeight]);

  // A selection made anywhere else (canvas, a command, undo) points at a row
  // that may be scrolled away or folded shut; a drag is excluded so rows never
  // move under the pointer mid-drop.
  useEffect(() => {
    if (drag) return;
    const last = selection[selection.length - 1];
    if (last) setReveal(last);
  }, [selection]);

  const clearDnd = () => {
    setDrag(null);
    setDrop(null);
  };

  // Hovering a row outlines that node on the canvas (see canvas/highlight.ts).
  // Touch has no hover, and a finger resting on a row before its long-press
  // drag must not paint chrome, so only hovering devices report.
  const hoverProps = (id: string) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") setHighlight(id);
    },
    onPointerLeave: () => clearHighlight(id),
  });

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
  // quick swipe still scrolls the list. The drop target is hit-tested from the
  // row under the pointer via its data attributes, mirroring the middle-third
  // "into group" and before/after logic the old dragover used.
  const startRowDrag = useTouchDrag<Drag>({
    onStart: (d) => {
      setDrag(d);
      startEdgeScroll();
    },
    onMove: (d, { y, target }) => {
      edgeSpeed.current = edgeScrollSpeed(y);
      const rowEl = target?.closest<HTMLElement>("[data-row-index]");
      if (rowEl) {
        const parentAttr = rowEl.dataset.rowParent ?? "";
        const parent = parentAttr === "" ? null : parentAttr;
        const index = Number(rowEl.dataset.rowIndex);
        const flat = Number(rowEl.dataset.rowFlat);
        const gid = rowEl.dataset.rowGroup;
        const r = rowEl.getBoundingClientRect();
        const ratio = (y - r.top) / r.height;
        const expandedContainer = !!gid && !collapsed.has(gid);
        if (
          gid && ratio > 0.28 && (expandedContainer || ratio < 0.72) &&
          canDropInto(d.ids, gid)
        ) {
          setDrop({ parent: gid, index: 0, inside: gid, line: flat + 1 });
          return;
        }
        // A drop line inside a dragged row's own subtree goes nowhere.
        if (parent !== null && !canDropInto(d.ids, parent)) {
          setDrop(null);
          return;
        }
        const after = ratio >= 0.5;
        setDrop({
          parent,
          index: after ? index + 1 : index,
          line: after ? flat + 1 : flat,
        });
        return;
      }
      if (target?.closest(".layers-list")) {
        setDrop({ parent: null, index: roots.length, line: rows.length });
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

  /** Data attributes + pointerdown that make a row draggable and droppable. */
  const rowDnd = (id: string, row: Row, flat: number, gid?: string) => {
    return {
      "data-row-id": id,
      "data-row-flat": flat,
      "data-row-parent": row.parent ?? "",
      "data-row-index": row.index,
      ...(gid ? { "data-row-group": gid } : {}),
      onPointerDown:
        editing === id
          ? undefined
          : (e: React.PointerEvent) => startRowDrag(e, { ids: draggedIds(id) }),
    };
  };

  const nameEditor = (
    current: string,
    commit: (name: string) => void
  ) => (
    <input
      className="layer-name-input"
      autoFocus
      defaultValue={current}
      onBlur={(e) => {
        commit(e.target.value.trim() || current);
        setEditing(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setEditing(null);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );

  const shapeRow = (row: Row, flat: number) => {
    const { node, depth, dim } = row;
    const shape = node.shape!;
    const id = shape.id;
    const isMask = isClippingMaskNode(doc, id);
    const isCompound = shape.type === "compoundPath";
    const isCollapsed = collapsed.has(id);
    return (
      <div
        className={
          "layer-row" +
          (selection.includes(id) ? " selected" : "") +
          (shape.hidden || dim ? " hidden" : "") +
          (isCompound ? " group-header" : "") +
          (drop?.inside === id && isCollapsed ? " drop-inside" : "")
        }
        title={isMask ? "Clipping mask" : undefined}
        style={{ paddingLeft: 6 + depth * 16 }}
        {...hoverProps(id)}
        {...rowDnd(id, row, flat, isCompound ? id : undefined)}
        onClick={(e) => rowClick(id, e)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!selection.includes(id)) selectIds([id], false);
          openContextMenu(e.clientX, e.clientY, [
            { label: "Rename", onSelect: () => setEditing(id) },
            {
              label: shape.hidden ? "Show" : "Hide",
              onSelect: () => toggleHidden(id),
            },
            {
              label: shape.locked ? "Unlock" : "Lock",
              onSelect: () => toggleLocked(id),
            },
            "separator",
            ...selectionMenu(),
          ]);
        }}
      >
        {isCompound && (
          <button
            className="layer-icon-btn layer-chevron"
            title={isCollapsed ? "Expand" : "Collapse"}
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(id);
            }}
          >
            {isCollapsed ? <LuChevronRight /> : <LuChevronDown />}
          </button>
        )}
        <button
          className={stateButtonClass(shape.hidden)}
          title={shape.hidden ? "Show" : "Hide"}
          onClick={(e) => {
            e.stopPropagation();
            toggleHidden(id);
          }}
        >
          {shape.hidden ? <LuEyeOff /> : <LuEye />}
        </button>
        <button
          className={stateButtonClass(shape.locked)}
          title={shape.locked ? "Unlock" : "Lock"}
          onClick={(e) => {
            e.stopPropagation();
            toggleLocked(id);
          }}
        >
          {shape.locked ? <LuLock /> : <LuLockOpen />}
        </button>
        <span className="layer-type" aria-hidden>
          {(() => {
            const Icon = TYPE_ICON[shape.type];
            return <Icon />;
          })()}
        </span>
        {editing === id ? (
          nameEditor(shape.name, (name) => renameNode(id, name))
        ) : (
          <span
            className="layer-name"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(id);
            }}
          >
            {shape.name}
            {isMask && <span className="layer-symbol-ref"> (Mask)</span>}
          </span>
        )}
      </div>
    );
  };

  const instanceRow = (row: Row, flat: number) => {
    const { node, depth, dim } = row;
    const instance = node.instance!;
    const id = instance.id;
    const symbolName = doc.symbols[instance.symbolId]?.name ?? "Missing symbol";
    return (
      <div
        className={
          "layer-row" +
          (selection.includes(id) ? " selected" : "") +
          (instance.hidden || dim ? " hidden" : "")
        }
        style={{ paddingLeft: 6 + depth * 16 }}
        {...hoverProps(id)}
        {...rowDnd(id, row, flat)}
        onClick={(e) => rowClick(id, e)}
        onDoubleClick={() => enterSymbolEdit(instance.symbolId)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!selection.includes(id)) selectIds([id], false);
          openContextMenu(e.clientX, e.clientY, [
            { label: "Rename", onSelect: () => setEditing(id) },
            { label: "Edit symbol", onSelect: () => enterSymbolEdit(instance.symbolId) },
            { label: "Detach instance", onSelect: detachSelectedInstances },
            {
              label: instance.hidden ? "Show" : "Hide",
              onSelect: () => toggleHidden(id),
            },
            {
              label: instance.locked ? "Unlock" : "Lock",
              onSelect: () => toggleLocked(id),
            },
            "separator",
            ...selectionMenu(),
          ]);
        }}
      >
        <button
          className={stateButtonClass(instance.hidden)}
          title={instance.hidden ? "Show" : "Hide"}
          onClick={(e) => {
            e.stopPropagation();
            toggleHidden(id);
          }}
        >
          {instance.hidden ? <LuEyeOff /> : <LuEye />}
        </button>
        <button
          className={stateButtonClass(instance.locked)}
          title={instance.locked ? "Unlock" : "Lock"}
          onClick={(e) => {
            e.stopPropagation();
            toggleLocked(id);
          }}
        >
          {instance.locked ? <LuLock /> : <LuLockOpen />}
        </button>
        <span className="layer-type" aria-hidden>
          <LuComponent />
        </span>
        {editing === id ? (
          nameEditor(instance.name, (name) => renameNode(id, name))
        ) : (
          <span
            className="layer-name"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(id);
            }}
          >
            {instance.name} <span className="layer-symbol-ref">({symbolName})</span>
          </span>
        )}
      </div>
    );
  };

  // Renders a container row: a group or a frame (frames are group-like, minus
  // the clip marker, plus a frame icon).
  const groupRow = (row: Row, flat: number) => {
    const { node, depth, dim } = row;
    const group = (node.group ?? node.frame)!;
    const gid = group.id;
    const kind = node.frame ? "frame" : "group";
    const ids = shapeIds([node]);
    const selected = selection.includes(gid);
    const isCollapsed = collapsed.has(gid);
    const isClip = node.group ? isClippingGroup(node.group) : false;
    return (
      <div
        className={
          "layer-row group-header" +
          (selected ? " selected" : "") +
          (group.hidden || dim ? " hidden" : "") +
          (drop?.inside === gid && isCollapsed ? " drop-inside" : "")
        }
        style={{ paddingLeft: 6 + depth * 16 }}
        {...hoverProps(gid)}
        {...rowDnd(gid, row, flat, gid)}
        onClick={(e) => rowClick(gid, e)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!selection.includes(gid)) {
            selectIds([gid], false);
          }
          openContextMenu(e.clientX, e.clientY, [
            { label: "Rename", onSelect: () => setEditing(gid) },
            {
              label: `${group.hidden ? "Show" : "Hide"} ${kind}`,
              onSelect: () => toggleHidden(gid),
            },
            {
              label: `${group.locked ? "Unlock" : "Lock"} ${kind}`,
              onSelect: () => toggleLocked(gid),
            },
            "separator",
            ...selectionMenu(),
          ]);
        }}
      >
        <button
          className="layer-icon-btn layer-chevron"
          title={isCollapsed ? "Expand" : "Collapse"}
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapsed(gid);
          }}
        >
          {isCollapsed ? <LuChevronRight /> : <LuChevronDown />}
        </button>
        <button
          className={stateButtonClass(group.hidden)}
          title={`${group.hidden ? "Show" : "Hide"} ${kind}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleHidden(gid);
          }}
        >
          {group.hidden ? <LuEyeOff /> : <LuEye />}
        </button>
        <button
          className={stateButtonClass(group.locked)}
          title={`${group.locked ? "Unlock" : "Lock"} ${kind}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleLocked(gid);
          }}
        >
          {group.locked ? <LuLock /> : <LuLockOpen />}
        </button>
        {node.frame && (
          <span className="layer-type" aria-hidden>
            <LuFrame />
          </span>
        )}
        {editing === gid ? (
          nameEditor(group.name, (name) => renameNode(gid, name))
        ) : (
          <span
            className="layer-name"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(gid);
            }}
          >
            {group.name}
            {isClip && <span className="layer-symbol-ref"> (Clip)</span>}
          </span>
        )}
        <span className="layer-count">{ids.length}</span>
      </div>
    );
  };

  const renderRow = (row: Row, flat: number) => (
    <Fragment key={row.key}>
      {row.node.group || row.node.frame
        ? groupRow(row, flat)
        : row.node.instance
          ? instanceRow(row, flat)
          : shapeRow(row, flat)}
    </Fragment>
  );

  const scopeName = scope ? doc.symbols[scope]?.name ?? "Symbol" : null;

  return (
    <div className={"layers" + (drag ? " dragging" : "")}>
      <div className="section-title layers-title">Layers</div>
      {scopeName !== null && (
        <button className="layers-scope" onClick={exitSymbolEdit}>
          <LuChevronLeft aria-hidden />
          <span>{scopeName}</span>
        </button>
      )}
      <div
        className="layers-list"
        ref={listRef}
        tabIndex={-1}
        onKeyDown={onListKeyDown}
        // Taking focus is what makes the arrow keys work, but stealing it from
        // a rename input would blur (and so commit) it on the first click.
        // `preventScroll` matters: the list is usually taller than the dock
        // body that scrolls it, so a plain focus() scrolls the list's top edge
        // into view — pushing the panel title off-screen on every click, chevron
        // and eye toggle included.
        onPointerDown={(e) => {
          if (!(e.target as HTMLElement).closest("input")) {
            e.currentTarget.focus({ preventScroll: true });
          }
        }}
        onPointerLeave={() => setHighlight(null)}
      >
        {rows.length === 0 && <div className="layers-empty">No shapes yet</div>}
        <div
          className="layers-rows"
          ref={rowsRef}
          style={windowed ? { height: rows.length * rowHeight } : undefined}
        >
          <div style={windowed ? { transform: `translateY(${first * rowHeight}px)` } : undefined}>
            {rows.slice(first, last).map((row, i) => renderRow(row, first + i))}
          </div>
          {drop && rowHeight > 0 && (
            <div
              className="drop-line"
              style={{
                top: drop.line * rowHeight,
                marginLeft: 6 + (rows[Math.min(drop.line, rows.length - 1)]?.depth ?? 0) * 16,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
