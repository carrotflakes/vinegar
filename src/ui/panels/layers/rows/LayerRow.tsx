// One row of the Layers panel. Every kind of node renders through here; what
// makes a group a group and an instance an instance is in rowSpec.ts.

import {
  LuChevronDown,
  LuChevronRight,
  LuEye,
  LuEyeOff,
  LuLock,
  LuLockOpen,
} from "react-icons/lu";
import { openContextMenu } from "@/store/menuStore";
import { selectionMenu } from "../../../menus";
import type { Row } from "../tree";
import type { LayerRowCtx } from "./rowContext";
import { rowSpec } from "./rowSpec";

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

  return (
    <div
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
        (ctx.dropInside === id && isCollapsed ? " drop-inside" : "")
      }
      title={spec.title}
      style={{ paddingLeft: 6 + row.depth * 16 }}
      {...ctx.hoverProps(id)}
      {...ctx.rowDnd(id, row, flat, spec.dropTarget)}
      onClick={(e) => ctx.rowClick(id, e)}
      onDoubleClick={spec.onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!ctx.selection.includes(id)) ctx.selectIds([id], false);
        openContextMenu(e.clientX, e.clientY, [
          { label: "Rename", onSelect: () => ctx.setEditing(id) },
          ...spec.menuBefore,
          { label: showLabel, onSelect: () => ctx.toggleHidden(id) },
          { label: lockLabel, onSelect: () => ctx.toggleLocked(id) },
          "separator",
          ...selectionMenu(),
        ]);
      }}
    >
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
