// One row of the Layers panel. Every kind of node renders through here; what
// makes a group a group and an instance an instance is in rowSpec.ts.

import { useRef, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuEllipsisVertical,
  LuEye,
  LuEyeOff,
  LuLock,
  LuLockOpen,
} from "react-icons/lu";
import { openContextMenu, type MenuEntry } from "@/store/menuStore";
import { selectionMenu } from "../../../menus";
import type { Row } from "../tree";
import type { LayerRowCtx } from "./rowContext";
import { SWIPE_TRIGGER } from "../../../useTouchDrag";
import { rowSpec } from "./rowSpec";

// How far the row follows the finger. No shorter than the trigger distance, so
// a row held at the stop always reads as "release me".
const SWIPE_MAX = 28;

const stateButtonClass = (isSet: boolean) =>
  `layer-icon-btn layer-state-btn ${isSet ? "state-set" : "state-idle"}`;

interface NameEditorProps {
  current: string;
  commit: (name: string) => void;
  done: () => void;
}

function NameEditor({ current, commit, done }: NameEditorProps) {
  return (
    <input
      className="layer-name-input"
      autoFocus
      defaultValue={current}
      onBlur={(e) => {
        commit(e.target.value.trim() || current);
        done();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") done();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function LayerRow({
  row,
  flat,
  ctx,
}: {
  row: Row;
  flat: number;
  ctx: LayerRowCtx;
}) {
  const spec = rowSpec(row, ctx);
  const { id, name, hidden, locked, stateSuffix } = spec;
  const Icon = spec.icon;
  const isCollapsed = ctx.collapsed.has(id);
  const hasChildren = (row.node.children?.length ?? 0) > 0;
  const showLabel = `${hidden ? "Show" : "Hide"}${stateSuffix}`;
  const lockLabel = `${locked ? "Unlock" : "Lock"}${stateSuffix}`;

  // How far a touch swipe has pulled the row right; 0 whenever none is live.
  const [swipeDx, setSwipeDx] = useState(0);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const menuEntries = (): MenuEntry[] => [
    { label: "Rename", onSelect: () => ctx.setEditing(id) },
    ...spec.menuBefore,
    { label: showLabel, onSelect: () => ctx.toggleHidden(id) },
    { label: lockLabel, onSelect: () => ctx.toggleLocked(id) },
    "separator",
    ...selectionMenu(),
  ];

  // A menu acts on the selection, so a row menued from outside it takes over.
  const openRowMenu = (x: number, y: number) => {
    if (!ctx.selection.includes(id)) ctx.selectIds([id], false);
    openContextMenu(x, y, menuEntries());
  };

  const swipe = {
    onMove: (dx: number) => setSwipeDx(Math.min(dx, SWIPE_MAX)),
    // Drop the menu below the row rather than at the release point: on touch
    // the finger is sitting exactly there.
    onOpen: (x: number, y: number) =>
      openRowMenu(x, rowRef.current?.getBoundingClientRect().bottom ?? y),
  };

  return (
    <div
      ref={rowRef}
      id={`layer-row-${id}`}
      role="treeitem"
      aria-selected={ctx.selection.includes(id)}
      aria-level={row.depth + 1}
      aria-expanded={hasChildren ? !isCollapsed : undefined}
      className={
        "layer-row" +
        (spec.groupHeader ? " group-header" : "") +
        (ctx.cursor === id ? " cursor" : "") +
        (ctx.selection.includes(id) ? " selected" : "") +
        (hidden || row.dim ? " hidden" : "") +
        (ctx.dropInside === id && isCollapsed ? " drop-inside" : "") +
        (swipeDx > 0 ? " swiping" : "")
      }
      title={spec.title}
      style={{
        paddingLeft: 6 + row.depth * 16,
        ...(swipeDx > 0 ? { transform: `translateX(${swipeDx}px)` } : null),
      }}
      {...ctx.hoverProps(id)}
      {...ctx.rowDnd(id, row, flat, swipe, spec.dropTarget)}
      onClick={(e) => ctx.rowClick(id, e)}
      onDoubleClick={spec.onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        openRowMenu(e.clientX, e.clientY);
      }}
    >
      {/* Follows the finger out from under the row, so a swipe that stops short
          still shows what it was about to do, and lights up once far enough
          that releasing would open the menu. */}
      {swipeDx > 0 && (
        <span
          className={
            "layer-swipe-hint" + (swipeDx >= SWIPE_TRIGGER ? " armed" : "")
          }
          style={{ opacity: Math.min(1, swipeDx / SWIPE_TRIGGER) }}
          aria-hidden
        >
          <LuEllipsisVertical />
        </span>
      )}
      {spec.chevron && (
        <button
          className="layer-icon-btn layer-chevron"
          title={isCollapsed ? "Expand" : "Collapse"}
          onClick={(e) => {
            e.stopPropagation();
            ctx.toggleCollapsed(id);
          }}
        >
          {isCollapsed ? <LuChevronRight /> : <LuChevronDown />}
        </button>
      )}
      <button
        className={stateButtonClass(hidden)}
        title={showLabel}
        onClick={(e) => {
          e.stopPropagation();
          ctx.toggleHidden(id);
        }}
      >
        {hidden ? <LuEyeOff /> : <LuEye />}
      </button>
      <button
        className={stateButtonClass(locked)}
        title={lockLabel}
        onClick={(e) => {
          e.stopPropagation();
          ctx.toggleLocked(id);
        }}
      >
        {locked ? <LuLock /> : <LuLockOpen />}
      </button>
      {Icon && (
        <span className="layer-type" aria-hidden>
          <Icon />
        </span>
      )}
      {ctx.editing === id ? (
        <NameEditor
          current={name}
          commit={(next) => ctx.renameNode(id, next)}
          done={() => ctx.setEditing(null)}
        />
      ) : (
        <span
          className="layer-name"
          onDoubleClick={(e) => {
            e.stopPropagation();
            ctx.setEditing(id);
          }}
        >
          {name}
          {spec.badge && <span className="layer-symbol-ref"> {spec.badge}</span>}
        </span>
      )}
      {spec.count !== null && <span className="layer-count">{spec.count}</span>}
    </div>
  );
}
