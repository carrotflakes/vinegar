import { Fragment, useState, type ComponentType } from "react";
import {
  LuSquare,
  LuCircle,
  LuSlash,
  LuWaves,
  LuPenTool,
  LuHexagon,
  LuEye,
  LuEyeOff,
  LuLock,
  LuLockOpen,
  LuChevronRight,
  LuChevronDown,
} from "react-icons/lu";
import type { Group, Shape } from "../model/types";
import { descendantNodeIds, isGroup, isShape } from "../model/scene";
import { useEditor } from "../store/editorStore";
import { openContextMenu } from "../store/menuStore";
import { selectionMenu } from "./menus";

const TYPE_ICON: Record<Shape["type"], ComponentType> = {
  rect: LuSquare,
  ellipse: LuCircle,
  line: LuSlash,
  path: LuWaves,
  bezier: LuPenTool,
  polygon: LuHexagon,
};

/** Display node: the render tree with every level front-most first. */
interface DNode {
  key: string;
  shape?: Shape;
  group?: Group;
  children?: DNode[];
}

function toDisplayTree(doc: ReturnType<typeof useEditor.getState>["doc"], ids: string[]): DNode[] {
  const result: DNode[] = [];
  for (const id of ids) {
    const node = doc.nodes[id];
    if (isGroup(node)) result.push({ key: id, group: node, children: toDisplayTree(doc, node.childIds) });
    else if (isShape(node)) result.push({ key: id, shape: node });
  }
  return result.reverse();
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
  inside?: string;
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
  const moveNode = useEditor((s) => s.moveNode);

  const [editing, setEditing] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  const roots = toDisplayTree(doc, doc.rootIds);

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
    if (!d || !t) return;
    const siblings = childrenOf(roots, t.parent);
    if (!siblings) return;
    const from = d.parent === t.parent
      ? siblings.findIndex((n) => n.key === d.id)
      : -1;
    let idx = t.index;
    if (from >= 0 && from < idx) idx -= 1;
    const displayIds = siblings.map((n) => n.key).filter((id) => id !== d.id);
    idx = Math.max(0, Math.min(idx, displayIds.length));
    displayIds.splice(idx, 0, d.id);
    const canonicalIndex = displayIds.length - 1 - idx;
    moveNode(d.id, t.parent, canonicalIndex);
  };

  /** Map a row hover to before/after, or its middle third into a group. */
  const onRowDragOver = (
    e: React.DragEvent,
    path: Path,
    groupId?: string
  ) => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - r.top) / r.height;
    if (
      groupId && ratio > 0.28 && ratio < 0.72 &&
      groupId !== drag.id &&
      !descendantNodeIds(doc, drag.id).includes(groupId)
    ) {
      setDrop({ parent: groupId, index: 0, inside: groupId });
      return;
    }
    const at = path[path.length - 1];
    setDrop({ parent: at.parent, index: ratio >= 0.5 ? at.index + 1 : at.index });
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
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", id);
          setDrag({ id, parent: path[path.length - 1].parent });
        }}
        onDragOver={(e) => onRowDragOver(e, path)}
        {...dropProps}
        onClick={(e) => selectIds([id], e.shiftKey)}
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
        <button
          className="layer-icon-btn"
          title={shape.hidden ? "Show" : "Hide"}
          onClick={(e) => {
            e.stopPropagation();
            toggleHidden(id);
          }}
        >
          {shape.hidden ? <LuEyeOff /> : <LuEye />}
        </button>
        <button
          className="layer-icon-btn"
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
    const selected = selection.includes(gid);
    const isCollapsed = collapsed.has(gid);
    return (
      <div
        className={
          "layer-row group-header" +
          (selected ? " selected" : "") +
          (group.hidden || dim ? " hidden" : "") +
          (drop?.inside === gid ? " drop-inside" : "")
        }
        style={{ paddingLeft: 6 + depth * 16 }}
        draggable={editing !== gid}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", gid);
          setDrag({ id: gid, parent: path[path.length - 1].parent });
        }}
        onDragOver={(e) => onRowDragOver(e, path, gid)}
        {...dropProps}
        onClick={(e) => selectIds([gid], e.shiftKey)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!selection.includes(gid)) {
            selectIds([gid], false);
          }
          openContextMenu(e.clientX, e.clientY, [
            { label: "Rename", onSelect: () => setEditing(gid) },
            {
              label: group.hidden ? "Show group" : "Hide group",
              onSelect: () => updateGroupStyle(gid, { hidden: !group.hidden }),
            },
            {
              label: group.locked ? "Unlock group" : "Lock group",
              onSelect: () => updateGroupStyle(gid, { locked: !group.locked }),
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
          className="layer-icon-btn"
          title={group.hidden ? "Show group" : "Hide group"}
          onClick={(e) => {
            e.stopPropagation();
            updateGroupStyle(gid, { hidden: !group.hidden });
          }}
        >
          {group.hidden ? <LuEyeOff /> : <LuEye />}
        </button>
        <button
          className="layer-icon-btn"
          title={group.locked ? "Unlock group" : "Lock group"}
          onClick={(e) => {
            e.stopPropagation();
            updateGroupStyle(gid, { locked: !group.locked });
          }}
        >
          {group.locked ? <LuLock /> : <LuLockOpen />}
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
              <div
                className="drop-line-flow"
                style={{ marginLeft: 6 + depth * 16 }}
              />
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
        <div
          className="drop-line-flow"
          style={{ marginLeft: 6 + depth * 16 }}
        />
      )}
    </>
  );

  return (
    <div className="layers">
      <div className="panel-title layers-title">Layers</div>
      <div
        className="layers-list"
        onDragOver={(e) => {
          if (!drag || e.target !== e.currentTarget) return;
          e.preventDefault();
          setDrop({ parent: null, index: roots.length });
        }}
        onDrop={(e) => {
          e.preventDefault();
          commitDrop();
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
        }}
      >
        {roots.length === 0 && <div className="layers-empty">No shapes yet</div>}
        {renderList(roots, null, 0, [], false)}
      </div>
    </div>
  );
}
