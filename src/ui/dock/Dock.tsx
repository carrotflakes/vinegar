import { Fragment, useRef, useState } from "react";
import { LuPlus, LuX } from "react-icons/lu";
import { openContextMenu } from "../../store/menuStore";
import {
  addTab,
  closeTab,
  hiddenPanels,
  placeTab,
  setActiveTab,
  type DropTarget,
} from "./dockLayout";
import { useDock } from "./dockStore";
import { PANEL_IDS, PANEL_MAP } from "./panels";
import { useTouchDrag } from "../useTouchDrag";
import "./dock.css";

const MIN_GROUP = 90;

/**
 * The right sidebar rendered from a layout: a vertical column of tab groups.
 * Tabs drag to reorder within a group, drop onto another group's tab bar to
 * move, or drop onto a group's body to split off into a new group. Group heights
 * are resized by the dividers between them. Everything persists to localStorage.
 */
export default function Dock() {
  const layout = useDock((s) => s.layout);
  const setLayout = useDock((s) => s.setLayout);
  const [dragPanel, setDragPanel] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const groupEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const resizeRef = useRef<{
    aId: string;
    bId: string;
    startY: number;
    heights: Map<string, number>;
  } | null>(null);

  const totalTabs = layout.reduce((n, g) => n + g.tabs.length, 0);
  const hidden = hiddenPanels(layout, PANEL_IDS);

  const commitDrop = () => {
    if (dragPanel && dropTarget) {
      setLayout((l) => placeTab(l, dragPanel, dropTarget));
    }
    setDragPanel(null);
    setDropTarget(null);
  };

  const endDrag = () => {
    setDragPanel(null);
    setDropTarget(null);
  };

  // Pointer-based tab drag (works for mouse and touch). The drop target is
  // hit-tested from the element under the pointer via data attributes, so a
  // finger sliding across groups lands the same as a mouse would.
  const startTabDrag = useTouchDrag<string>({
    onStart: (id) => setDragPanel(id),
    onMove: (_id, { x, y, target }) => {
      const tabsEl = target?.closest<HTMLElement>('[data-dock-tabs]');
      if (tabsEl) {
        const groupId = tabsEl.dataset.dockTabs!;
        const tabEls = Array.from(
          tabsEl.querySelectorAll<HTMLElement>(".dock-tab")
        );
        let index = tabEls.length;
        for (let t = 0; t < tabEls.length; t++) {
          const r = tabEls[t].getBoundingClientRect();
          if (x < r.left + r.width / 2) {
            index = t;
            break;
          }
        }
        setDropTarget({ kind: "tab", groupId, index });
        return;
      }
      const bodyEl = target?.closest<HTMLElement>('[data-dock-body]');
      if (bodyEl) {
        const r = bodyEl.getBoundingClientRect();
        const before = (y - r.top) / r.height < 0.5;
        setDropTarget({
          kind: "split",
          beforeGroupId: before
            ? bodyEl.dataset.dockBody!
            : bodyEl.dataset.dockNext || null,
        });
        return;
      }
      setDropTarget(null);
    },
    onDrop: () => commitDrop(),
    onCancel: endDrag,
  });

  // --- Divider resize: normalize every group to its pixel height on grab, then
  // trade height between the two adjacent groups as the divider moves.
  const onDividerDown = (e: React.PointerEvent, aId: string, bId: string) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const heights = new Map<string, number>();
    for (const [id, el] of groupEls.current) heights.set(id, el.offsetHeight);
    resizeRef.current = { aId, bId, startY: e.clientY, heights };
  };
  const onDividerMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const dy = e.clientY - r.startY;
    const ha = (r.heights.get(r.aId) ?? MIN_GROUP) + dy;
    const hb = (r.heights.get(r.bId) ?? MIN_GROUP) - dy;
    if (ha < MIN_GROUP || hb < MIN_GROUP) return;
    setLayout((l) =>
      l.map((g) => {
        if (g.id === r.aId) return { ...g, flex: ha };
        if (g.id === r.bId) return { ...g, flex: hb };
        const h = r.heights.get(g.id);
        return h ? { ...g, flex: h } : g;
      })
    );
  };
  const onDividerUp = (e: React.PointerEvent) => {
    resizeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const openAddMenu = (e: React.MouseEvent, groupId: string) => {
    e.stopPropagation();
    const items =
      hidden.length > 0
        ? hidden.map((id) => ({
            label: PANEL_MAP[id].title,
            onSelect: () => setLayout((l) => addTab(l, id, groupId)),
          }))
        : [{ label: "All panels shown", disabled: true, onSelect: () => {} }];
    openContextMenu(e.clientX, e.clientY, items);
  };

  return (
    <div className="dock">
      {layout.map((group, i) => {
        const nextId = layout[i + 1]?.id ?? null;
        // A split inserts a new group "before beforeGroupId". Mark the boundary
        // the cursor is actually over: the bottom edge of this group when the
        // insertion falls just after it (before `nextId`, or an append when
        // `nextId` is null), and the very top only for the first group.
        const splitBottom =
          dropTarget?.kind === "split" && dropTarget.beforeGroupId === nextId;
        const splitTop =
          dropTarget?.kind === "split" &&
          i === 0 &&
          dropTarget.beforeGroupId === group.id;
        return (
          <Fragment key={group.id}>
            {i > 0 && (
              <div
                className="dock-divider"
                title="Drag to resize"
                onPointerDown={(e) =>
                  onDividerDown(e, layout[i - 1].id, group.id)
                }
                onPointerMove={onDividerMove}
                onPointerUp={onDividerUp}
                onPointerCancel={onDividerUp}
              />
            )}
            <div
              className="dock-group"
              style={{ flexGrow: group.flex, flexBasis: 0 }}
              ref={(el) => {
                if (el) groupEls.current.set(group.id, el);
                else groupEls.current.delete(group.id);
              }}
            >
              {splitTop && <div className="dock-split-drop top" />}
              {splitBottom && <div className="dock-split-drop bottom" />}
              <div
                className="dock-tabs"
                data-dock-tabs={group.id}
                onWheel={(e) => {
                  // Translate vertical wheel into horizontal scroll so the tab
                  // bar can be panned without holding Shift.
                  if (e.deltaX === 0 && e.deltaY !== 0) {
                    e.currentTarget.scrollLeft += e.deltaY;
                  }
                }}
              >
                {group.tabs.map((id, idx) => (
                  <Fragment key={id}>
                    {dropTarget?.kind === "tab" &&
                      dropTarget.groupId === group.id &&
                      dropTarget.index === idx && (
                        <span className="dock-tab-drop" />
                      )}
                    <div
                      className={
                        "dock-tab" + (group.active === id ? " active" : "")
                      }
                      onPointerDown={(e) => startTabDrag(e, id)}
                      onClick={() =>
                        setLayout((l) => setActiveTab(l, group.id, id))
                      }
                    >
                      <span className="dock-tab-label">
                        {PANEL_MAP[id].title}
                      </span>
                      {totalTabs > 1 && (
                        <button
                          className="dock-tab-close"
                          title="Close panel"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLayout((l) => closeTab(l, id));
                          }}
                        >
                          <LuX aria-hidden />
                        </button>
                      )}
                    </div>
                  </Fragment>
                ))}
                {dropTarget?.kind === "tab" &&
                  dropTarget.groupId === group.id &&
                  dropTarget.index === group.tabs.length && (
                    <span className="dock-tab-drop" />
                  )}
                <button
                  className="dock-add"
                  title="Add panel"
                  onClick={(e) => openAddMenu(e, group.id)}
                >
                  <LuPlus aria-hidden />
                </button>
              </div>
              <div
                className="dock-body"
                data-dock-body={group.id}
                data-dock-next={nextId ?? ""}
              >
                {PANEL_MAP[group.active]?.render()}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
