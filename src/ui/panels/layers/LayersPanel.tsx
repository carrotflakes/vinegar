import { useEffect, useRef, useState } from "react";
import {
  LuChevronLeft,
  LuChevronsDownUp,
  LuListChecks,
  LuSearch,
  LuX,
} from "react-icons/lu";
import {
  ancestorIds,
  enclosingSymbolId,
  childIdsOfNode,
  scopeRootIds,
} from "@/model/scene";
import { isMac } from "@/commands/registry";
import { currentFocusRoot, useEditor } from "@/store/editorStore";
import { useHighlight } from "@/store/highlightStore";
import { useLayersView } from "@/store/layersViewStore";
import { readModifiers } from "@/store/inputStore";
import type { MenuEntry } from "@/store/menuStore";
import { DropdownMenu } from "@/ui/menu/Menu";
import { rangeIds, visibleIds, ROW_INDENT, ROW_PAD } from "./tree";
import { layersView, listKeyAction, searchKeyAction } from "./view";
import { useLayersDnd } from "./useLayersDnd";
import { useRowWindow } from "./useRowWindow";
import { LayerRow } from "./rows/LayerRow";
import type { LayerRowCtx } from "./rows/rowContext";
import "../../Panel.css";
import "../PanelList.css";

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
  const raiseSelected = useEditor((s) => s.raiseSelected);
  const lowerSelected = useEditor((s) => s.lowerSelected);
  const scope = useEditor((s) => currentFocusRoot(s));
  const exitFocus = useEditor((s) => s.exitFocus);
  const enterSymbolInstance = useEditor((s) => s.enterSymbolInstance);
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
  const multiSelect = useLayersView((s) => s.multiSelect);
  const toggleMultiSelect = useLayersView((s) => s.toggleMultiSelect);
  const setMultiSelect = useLayersView((s) => s.setMultiSelect);
  const expandContainers = useLayersView((s) => s.expand);
  const setCollapsed = useLayersView((s) => s.setCollapsed);
  const search = useLayersView((s) => s.search);
  const setSearch = useLayersView((s) => s.setSearch);
  // Range selection keeps two marks, like any list: `anchor` is where a range
  // starts and `cursor` is the row the keyboard sits on / the last one clicked.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);

  // Inside a focus scope the panel shows that container's tree; a drop at the
  // panel root then targets the focused container, not the scene.
  const scopeParent = scope;

  // Everything the panel shows, derived in view.ts so it can be tested without
  // rendering the component.
  const { query, filtering, roots, rows, folds, foldable, hitCount, firstHit } =
    layersView({
      doc,
      rootIds: scopeRootIds(doc, scope),
      search,
      collapsed,
    });

  const { listRef, rowsRef, scrollerRef, rowHeight, windowed, first, last } =
    useRowWindow(rows.length);

  const dnd = useLayersDnd({
    doc,
    roots,
    rows,
    collapsed: folds,
    selection,
    editing,
    enabled: !filtering,
    scopeParent,
    scrollerRef,
    moveNodes,
  });

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
   * well, and the panel's multi-select mode stands in for Ctrl/Cmd. Both exist
   * because touch has no modifier keys and every gesture a row could use is
   * already spoken for (tap selects, long-press drags, a vertical swipe
   * scrolls, a rightward swipe opens the row's context menu).
   * See canvas/ModifierBar.tsx.
   */
  const rowClick = (id: string, e: React.MouseEvent) => {
    const { shift } = readModifiers(e);
    const from = rangeStart();
    if (shift && from && from !== id) {
      const range = rangeIds(doc, visibleIds(roots, folds), from, id);
      if (range) {
        setSelection(range);
        setCursor(id); // the anchor stays put, so Shift+click re-extends from it
        return;
      }
    }
    // Ctrl+click is the macOS secondary click, so there Cmd alone toggles.
    selectIds(
      [id],
      multiSelect || shift || e.metaKey || (!isMac && e.ctrlKey)
    );
  };

  /**
   * Arrow-key row navigation, for the focused list only (the canvas keeps its
   * own keys). Plain moves the cursor and selects that row; Shift extends the
   * range from the anchor, exactly like Shift+click. Left/Right fold and unfold
   * the container under the cursor so a collapsed subtree stays reachable.
   */
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (editing !== null) return; // a rename input owns the keyboard
    const order = visibleIds(roots, folds);
    const at = cursor ?? rangeStart();
    const node = at ? doc.nodes[at] : undefined;
    const action = listKeyAction({
      key: e.key,
      alt: e.altKey,
      shift: e.shiftKey,
      order,
      at,
      filtering,
      collapsed: at ? collapsed.has(at) : false,
      foldable: node ? childIdsOfNode(node).length > 0 : false,
    });
    // The arrows are claimed either way: with the list focused they navigate
    // rows rather than nudging the artwork.
    if (e.key.startsWith("Arrow")) e.preventDefault();
    if (!action) return;
    if (action.type === "raise" || action.type === "lower") {
      if (action.type === "raise") raiseSelected();
      else lowerSelected();
      if (cursor) setReveal(cursor);
      return;
    }
    if (action.type === "fold") {
      toggleCollapsed(action.id);
      return;
    }
    const from = action.extend ? rangeStart() : null;
    const range = from ? rangeIds(doc, order, from, action.to) : null;
    if (range) setSelection(range);
    else selectIds([action.to], false);
    setCursor(action.to);
    setReveal(action.to);
  };

  // Whatever was selected last should be visible: unfold the containers hiding
  // it, then scroll it into view. `nearest` keeps an already-visible row still,
  // so a click inside the panel never scrolls under the pointer. Runs again
  // after an unfold, because the row only exists once its ancestors are open.
  useEffect(() => {
    if (!reveal) return;
    const hidden = filtering
      ? []
      : ancestorIds(doc, reveal).filter((a) => collapsed.has(a));
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
  }, [reveal, collapsed, doc, rowHeight, filtering]);

  // Multi-select is a way to build a selection up, so it ends when that
  // selection is gone — deselected row by row here, or dropped from anywhere
  // else. A mode that outlives its purpose is the kind that surprises the next
  // tap. Turning it on with nothing selected is not that case, hence the
  // "had something" mark rather than a plain emptiness test.
  const hadSelection = useRef(selection.length > 0);
  useEffect(() => {
    if (multiSelect && hadSelection.current && selection.length === 0) {
      setMultiSelect(false);
    }
    hadSelection.current = selection.length > 0;
  }, [selection, multiSelect]);

  // A selection made anywhere else (canvas, a command, undo) points at a row
  // that may be scrolled away or folded shut; a drag is excluded so rows never
  // move under the pointer mid-drop.
  useEffect(() => {
    if (dnd.dragging) return;
    const last = selection[selection.length - 1];
    if (last) setReveal(last);
  }, [selection]);

  // Hovering a row outlines that node on the canvas (see canvas/highlight.ts).
  // Touch has no hover, and a finger resting on a row before its long-press
  // drag must not paint chrome, so only hovering devices report.
  const hoverProps = (id: string) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") setHighlight(id);
    },
    onPointerLeave: () => clearHighlight(id),
  });

  const rowCtx: LayerRowCtx = {
    doc,
    selection,
    cursor,
    collapsed: folds,
    query,
    multiSelect,
    editing,
    dropInside: dnd.drop?.inside,
    setEditing,
    toggleCollapsed,
    toggleHidden,
    toggleLocked,
    renameNode,
    enterSymbolInstance,
    detachSelectedInstances,
    selectIds,
    rowClick,
    hoverProps,
    rowDnd: dnd.rowDnd,
  };

  /**
   * Fold commands for the whole tree. Reaching every container by clicking its
   * chevron is the part that does not scale, which is exactly where a deep
   * document needs help. "Collapse others" keeps the way down to the selection
   * open, so it isolates a branch instead of hiding the row the user is on.
   */
  const foldMenu = (): MenuEntry[] => {
    // The whole tree, not the filtered one: folds belong to the document view,
    // and a search that is about to be closed should not narrow what they reach.
    const containers = foldable;
    const keep = new Set(
      selection.flatMap((id) => [id, ...ancestorIds(doc, id)])
    );
    const others = containers.filter((id) => !keep.has(id));
    return [
      {
        label: "Expand all",
        disabled: collapsed.size === 0,
        onSelect: () => setCollapsed([]),
      },
      {
        label: "Collapse all",
        disabled: containers.every((id) => collapsed.has(id)),
        onSelect: () => setCollapsed(containers),
      },
      {
        label: "Collapse others",
        disabled: selection.length === 0 || others.length === 0,
        onSelect: () => setCollapsed(others),
      },
    ];
  };

  /**
   * Enter (or Down) in the search field goes to the first hit: finding a layer
   * is only half the job, and selecting it is what shows it on the canvas and
   * fills the Properties panel. Focus moves to the list so the arrows keep
   * walking the results from there.
   */
  const jumpToFirstHit = () => {
    if (!firstHit) return;
    selectIds([firstHit], false);
    setReveal(firstHit);
    listRef.current?.focus({ preventScroll: true });
  };

  // The scope is a container node id; a symbol's definition root reads as the
  // symbol's name rather than as the anonymous group holding its content.
  const scopeSymbol = scope ? doc.symbols[enclosingSymbolId(doc, scope) ?? ""] : undefined;
  const scopeName = scope
    ? (scopeSymbol?.rootNodeId === scope ? scopeSymbol.name : doc.nodes[scope]?.name) || "Group"
    : null;

  return (
    <div className={"layers" + (dnd.dragging ? " dragging" : "")}>
      {/* Title and scope travel together: it is the dock body that scrolls the
          panel, so they are one sticky block rather than two. */}
      <div className="panel-header">
        <div className="section-title panel-title">
          Layers
          <div className="title-actions">
            <button
              className={"layer-icon-btn" + (search !== null ? " active" : "")}
              title="Search layers"
              aria-label="Search layers"
              aria-pressed={search !== null}
              onClick={() => setSearch(search === null ? "" : null)}
            >
              <LuSearch aria-hidden />
            </button>
            <button
              className={"layer-icon-btn" + (multiSelect ? " active" : "")}
              title={
                multiSelect
                  ? "Multi-select on — a tap adds or removes a layer"
                  : "Multi-select: tap layers to add them to the selection"
              }
              aria-label="Multi-select"
              aria-pressed={multiSelect}
              onClick={toggleMultiSelect}
            >
              <LuListChecks aria-hidden />
            </button>
            <DropdownMenu
              entries={foldMenu()}
              placement="bottom-end"
              renderTrigger={({ ref, open, props }) => (
                <button
                  ref={ref}
                  className="layer-icon-btn"
                  title="Expand / collapse"
                  aria-label="Expand and collapse options"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  {...props}
                >
                  <LuChevronsDownUp aria-hidden />
                </button>
              )}
            />
          </div>
        </div>
        {scopeName !== null && (
          <button className="layers-scope" onClick={exitFocus}>
            <LuChevronLeft aria-hidden />
            <span>{scopeName}</span>
          </button>
        )}
        {search !== null && (
          <div className="layers-search">
            <LuSearch className="layers-search-icon" aria-hidden />
            <input
              className="layers-search-input"
              value={search}
              placeholder="Name, type, symbol…"
              aria-label="Search layers"
              // Opened by an explicit click on the search button, so the field
              // takes the keyboard straight away.
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                const action = searchKeyAction(e.key, search);
                if (action === "jump") {
                  e.preventDefault();
                  jumpToFirstHit();
                }
                if (action === "clear") setSearch("");
                if (action === "close") setSearch(null);
              }}
            />
            {filtering && (
              <span className="layers-search-count">{hitCount}</span>
            )}
            <button
              className="layer-icon-btn"
              title="Close search"
              aria-label="Close search"
              onClick={() => setSearch(null)}
            >
              <LuX aria-hidden />
            </button>
          </div>
        )}
      </div>
      <div
        className="layers-list"
        ref={listRef}
        role="tree"
        aria-label="Layers"
        aria-multiselectable="true"
        tabIndex={0}
        aria-activedescendant={cursor ? `layer-row-${cursor}` : undefined}
        // Landing on the list with no cursor yet (Tab, not a click) should adopt
        // the current selection so the first arrow keypress has somewhere to go.
        onFocus={() => {
          if (cursor) return;
          const start = rangeStart();
          if (start) setCursor(start);
        }}
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
        {rows.length === 0 && (
          <div className="layers-empty">
            {filtering ? "No layers match" : "No shapes yet"}
          </div>
        )}
        <div
          className="layers-rows"
          ref={rowsRef}
          style={windowed ? { height: rows.length * rowHeight } : undefined}
        >
          <div style={windowed ? { transform: `translateY(${first * rowHeight}px)` } : undefined}>
            {rows.slice(first, last).map((row, i) => (
              <LayerRow key={row.key} row={row} flat={first + i} ctx={rowCtx} />
            ))}
          </div>
          {dnd.drop && rowHeight > 0 && (
            <div
              className="drop-line"
              style={{
                top: dnd.drop.line * rowHeight,
                marginLeft: ROW_PAD + dnd.drop.depth * ROW_INDENT,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
