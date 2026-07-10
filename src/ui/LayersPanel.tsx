import { Fragment, useState } from "react";
import { buildRenderTree, type RenderNode } from "../canvas/render";
import type { Group, Shape } from "../model/types";
import { useEditor } from "../store/editorStore";

const TYPE_ICON: Record<Shape["type"], string> = {
  rect: "▭",
  ellipse: "◯",
  line: "╱",
  path: "〜",
  bezier: "✒",
  polygon: "⬟",
};

/** Display node: the render tree with every level front-most first. */
interface DNode {
  key: string;
  shape?: Shape;
  group?: Group;
  children?: DNode[];
}

function toDisplayTree(nodes: RenderNode[]): DNode[] {
  return nodes
    .map((n) =>
      n.kind === "shape"
        ? { key: n.shape.id, shape: n.shape }
        : {
            key: n.group.id,
            group: n.group,
            children: toDisplayTree(n.children),
          }
    )
    .reverse();
}

/** All descendant shape ids, in display order. */
function shapeIds(nodes: DNode[]): string[] {
  return nodes.flatMap((n) => (n.children ? shapeIds(n.children) : [n.key]));
}

/** The children array of a container (`null` = root). */
function childrenOf(roots: DNode[], parent: string | null): DNode[] | null {
  if (parent === null) return roots;
  for (const n of roots) {
    if (!n.children) continue;
    if (n.key === parent) return n.children;
    const found = childrenOf(n.children, parent);
    if (found) return found;
  }
  return null;
}

/** Where a row sits: its container and index at every ancestor level. */
type Path = { parent: string | null; index: number }[];

interface Drag {
  id: string;
  parent: string | null;
}

interface Drop {
  parent: string | null;
  index: number;
}

export default function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const toggleLocked = useEditor((s) => s.toggleLocked);
  const updateGroupStyle = useEditor((s) => s.updateGroupStyle);
  const renameShape = useEditor((s) => s.renameShape);
  const renameGroup = useEditor((s) => s.renameGroup);
  const setOrder = useEditor((s) => s.setOrder);

  const [editing, setEditing] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  const roots = toDisplayTree(buildRenderTree(doc));

  const toggleCollapsed = (gid: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  };

  const selectIds = (ids: string[], shift: boolean) => {
    if (shift) {
      const has = ids.every((id) => selection.includes(id));
      setSelection(
        has
          ? selection.filter((s) => !ids.includes(s))
          : [...new Set([...selection, ...ids])]
      );
    } else {
      setSelection(ids);
    }
  };

  const clearDnd = () => {
    setDrag(null);
    setDrop(null);
  };

  const commitDrop = () => {
    const d = drag;
    const t = drop;
    clearDnd();
    if (!d || !t || d.parent !== t.parent) return;
    const siblings = childrenOf(roots, t.parent);
    if (!siblings) return;
    const from = siblings.findIndex((n) => n.key === d.id);
    if (from < 0) return;
    let idx = t.index;
    if (from < idx) idx -= 1;
    const node = siblings[from];
    siblings.splice(from, 1);
    siblings.splice(idx, 0, node);
    setOrder(shapeIds(roots).reverse());
  };

  /** Map a hover to a drop slot at the dragged node's level, if any. */
  const onRowDragOver = (e: React.DragEvent, path: Path) => {
    if (!drag) return;
    const at = path.find((p) => p.parent === drag.parent);
    if (!at) {
      setDrop(null);
      return;
    }
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    setDrop({ parent: drag.parent, index: after ? at.index + 1 : at.index });
  };

  const dropProps = {
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      commitDrop();
    },
    onDragEnd: clearDnd,
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

  const shapeRow = (node: DNode, depth: number, path: Path, dim: boolean) => {
    const shape = node.shape!;
    const id = shape.id;
    return (
      <div
        className={
          "layer-row" +
          (selection.includes(id) ? " selected" : "") +
          (shape.hidden || dim ? " hidden" : "")
        }
        style={{ paddingLeft: 6 + depth * 16 }}
        draggable={editing !== id}
        onDragStart={() => setDrag({ id, parent: shape.groupId ?? null })}
        onDragOver={(e) => onRowDragOver(e, path)}
        {...dropProps}
        onClick={(e) => selectIds([id], e.shiftKey)}
      >
        <button
          className="layer-icon-btn"
          title={shape.hidden ? "Show" : "Hide"}
          onClick={(e) => {
            e.stopPropagation();
            toggleHidden(id);
          }}
        >
          {shape.hidden ? <EyeOff /> : <Eye />}
        </button>
        <button
          className="layer-icon-btn"
          title={shape.locked ? "Unlock" : "Lock"}
          onClick={(e) => {
            e.stopPropagation();
            toggleLocked(id);
          }}
        >
          {shape.locked ? <Lock /> : <Unlock />}
        </button>
        <span className="layer-type" aria-hidden>
          {TYPE_ICON[shape.type]}
        </span>
        {editing === id ? (
          nameEditor(shape.name, (name) => renameShape(id, name))
        ) : (
          <span
            className="layer-name"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(id);
            }}
          >
            {shape.name}
          </span>
        )}
      </div>
    );
  };

  const groupRow = (node: DNode, depth: number, path: Path, dim: boolean) => {
    const group = node.group!;
    const gid = group.id;
    const ids = shapeIds([node]);
    const selected = ids.length > 0 && ids.every((id) => selection.includes(id));
    const isCollapsed = collapsed.has(gid);
    return (
      <div
        className={
          "layer-row group-header" +
          (selected ? " selected" : "") +
          (group.hidden || dim ? " hidden" : "")
        }
        style={{ paddingLeft: 6 + depth * 16 }}
        draggable={editing !== gid}
        onDragStart={() => setDrag({ id: gid, parent: group.parentId ?? null })}
        onDragOver={(e) => onRowDragOver(e, path)}
        {...dropProps}
        onClick={(e) => selectIds(ids, e.shiftKey)}
      >
        <button
          className="layer-icon-btn layer-chevron"
          title={isCollapsed ? "Expand" : "Collapse"}
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapsed(gid);
          }}
        >
          {isCollapsed ? "▸" : "▾"}
        </button>
        <button
          className="layer-icon-btn"
          title={group.hidden ? "Show group" : "Hide group"}
          onClick={(e) => {
            e.stopPropagation();
            updateGroupStyle(gid, { hidden: !group.hidden });
          }}
        >
          {group.hidden ? <EyeOff /> : <Eye />}
        </button>
        <button
          className="layer-icon-btn"
          title={group.locked ? "Unlock group" : "Lock group"}
          onClick={(e) => {
            e.stopPropagation();
            updateGroupStyle(gid, { locked: !group.locked });
          }}
        >
          {group.locked ? <Lock /> : <Unlock />}
        </button>
        {editing === gid ? (
          nameEditor(group.name, (name) => renameGroup(gid, name))
        ) : (
          <span
            className="layer-name"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(gid);
            }}
          >
            {group.name}
          </span>
        )}
        <span className="layer-count">{ids.length}</span>
      </div>
    );
  };

  const renderList = (
    nodes: DNode[],
    parent: string | null,
    depth: number,
    parentPath: Path,
    dim: boolean
  ): React.ReactNode => (
    <>
      {nodes.map((n, i) => {
        const path: Path = [...parentPath, { parent, index: i }];
        return (
          <Fragment key={n.key}>
            {drop && drop.parent === parent && drop.index === i && (
              <div className="drop-line-flow" />
            )}
            {n.group ? (
              <>
                {groupRow(n, depth, path, dim)}
                {!collapsed.has(n.key) &&
                  renderList(
                    n.children!,
                    n.key,
                    depth + 1,
                    path,
                    dim || !!n.group.hidden
                  )}
              </>
            ) : (
              shapeRow(n, depth, path, dim)
            )}
          </Fragment>
        );
      })}
      {drop && drop.parent === parent && drop.index === nodes.length && (
        <div className="drop-line-flow" />
      )}
    </>
  );

  return (
    <div className="layers">
      <div className="panel-title layers-title">Layers</div>
      <div className="layers-list" onDragLeave={() => setDrop(null)}>
        {roots.length === 0 && <div className="layers-empty">No shapes yet</div>}
        {renderList(roots, null, 0, [], false)}
      </div>
    </div>
  );
}

// ---- tiny inline icons -----------------------------------------------------
function Eye() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path
        d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="8" r="1.8" fill="currentColor" />
    </svg>
  );
}
function EyeOff() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path
        d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.5"
      />
      <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function Lock() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="7" width="10" height="7" rx="1.3" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function Unlock() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect
        x="3"
        y="7"
        width="10"
        height="7"
        rx="1.3"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M5 7V5a3 3 0 0 1 5.8-1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
