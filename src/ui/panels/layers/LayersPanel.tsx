import { Fragment, useEffect, useState, type ComponentType } from "react";
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
import type { FrameNode, Group, Shape, SymbolInstance } from "../../../model/types";
import { isClippingGroup, isClippingMaskNode } from "../../../model/clippingMask";
import {
  descendantNodeIds,
  isCompoundPath,
  isFrame,
  isGroup,
  isInstance,
  isShape,
  scopeRootGroupId,
  scopeRootIds,
  selectionRoots,
} from "../../../model/scene";
import { isMac } from "../../../commands/registry";
import { currentSymbolScope, useEditor } from "../../../store/editorStore";
import { useHighlight } from "../../../store/highlightStore";
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

/** Display node: the render tree with every level front-most first. */
interface DNode {
  key: string;
  shape?: Shape;
  group?: Group;
  frame?: FrameNode;
  instance?: SymbolInstance;
  children?: DNode[] | undefined;
}

function toDisplayTree(doc: ReturnType<typeof useEditor.getState>["doc"], ids: string[]): DNode[] {
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

/** All descendant shape ids, in display order. */
function shapeIds(nodes: DNode[]): string[] {
  return nodes.flatMap((n) => (n.children ? shapeIds(n.children) : [n.key]));
}

/** Every row the list currently shows, top to bottom — the order Shift ranges over. */
function visibleIds(nodes: DNode[], collapsed: Set<string>): string[] {
  const out: string[] = [];
  const walk = (ns: DNode[]) => {
    for (const n of ns) {
      out.push(n.key);
      if (n.children && !collapsed.has(n.key)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
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
  const moveNode = useEditor((s) => s.moveNode);
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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  // In a symbol's local view the panel shows that definition's tree; a drop
  // at the panel root then targets the definition root group, not the scene.
  const scopeParent = scopeRootGroupId(doc, scope);
  const roots = toDisplayTree(doc, scopeRootIds(doc, scope));

  const toggleCollapsed = (gid: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  };

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
  };

  /**
   * List conventions (Finder/Photoshop/Figma): Shift extends a contiguous range
   * from the last clicked row, Ctrl/Cmd toggles one row. A range can straddle
   * nesting levels, so `selectionRoots` drops any row whose container is also in
   * the range — selecting a group *and* its children means nothing downstream.
   */
  const rowClick = (id: string, e: React.MouseEvent) => {
    // The anchor goes stale when the selection last changed elsewhere (canvas,
    // a command) or when its row scrolled out of the tree; the newest selected
    // row is the closest thing to "where the user last was".
    const from0 =
      anchor && selection.includes(anchor)
        ? anchor
        : selection[selection.length - 1] ?? anchor;
    if (e.shiftKey && from0 && from0 !== id) {
      const order = visibleIds(roots, collapsed);
      const from = order.indexOf(from0);
      const to = order.indexOf(id);
      if (from >= 0 && to >= 0) {
        const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
        setSelection(selectionRoots(doc, range));
        return; // keep the anchor so a further Shift+click re-extends from it
      }
    }
    // Ctrl+click is the macOS secondary click, so there Cmd alone toggles.
    selectIds([id], e.shiftKey || e.metaKey || (!isMac && e.ctrlKey));
  };

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
    const from = d.parent === t.parent
      ? siblings.findIndex((n) => n.key === d.id)
      : -1;
    let idx = t.index;
    if (from >= 0 && from < idx) idx -= 1;
    const displayIds = siblings.map((n) => n.key).filter((id) => id !== d.id);
    idx = Math.max(0, Math.min(idx, displayIds.length));
    displayIds.splice(idx, 0, d.id);
    const canonicalIndex = displayIds.length - 1 - idx;
    moveNode(d.id, t.parent ?? scopeParent, canonicalIndex);
  };

  // Pointer-based row drag (mouse + touch). Touch begins on a long-press so a
  // quick swipe still scrolls the list. The drop target is hit-tested from the
  // row under the pointer via its data attributes, mirroring the middle-third
  // "into group" and before/after logic the old dragover used.
  const startRowDrag = useTouchDrag<Drag>({
    onStart: (d) => setDrag(d),
    onMove: (d, { y, target }) => {
      const rowEl = target?.closest<HTMLElement>("[data-row-index]");
      if (rowEl) {
        const parentAttr = rowEl.dataset.rowParent ?? "";
        const parent = parentAttr === "" ? null : parentAttr;
        const index = Number(rowEl.dataset.rowIndex);
        const gid = rowEl.dataset.rowGroup;
        const r = rowEl.getBoundingClientRect();
        const ratio = (y - r.top) / r.height;
        const expandedContainer = !!gid && !collapsed.has(gid);
        if (
          gid && ratio > 0.28 && (expandedContainer || ratio < 0.72) &&
          gid !== d.id &&
          !descendantNodeIds(doc, d.id).includes(gid)
        ) {
          setDrop({ parent: gid, index: 0, inside: gid });
          return;
        }
        setDrop({ parent, index: ratio >= 0.5 ? index + 1 : index });
        return;
      }
      if (target?.closest(".layers-list")) {
        setDrop({ parent: null, index: roots.length });
        return;
      }
      setDrop(null);
    },
    onDrop: () => commitDrop(),
    onCancel: clearDnd,
  });

  /** Data attributes + pointerdown that make a row draggable and droppable. */
  const rowDnd = (id: string, path: Path, gid?: string) => {
    const at = path[path.length - 1];
    return {
      "data-row-parent": at.parent ?? "",
      "data-row-index": at.index,
      ...(gid ? { "data-row-group": gid } : {}),
      onPointerDown:
        editing === id
          ? undefined
          : (e: React.PointerEvent) =>
              startRowDrag(e, { id, parent: at.parent }),
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

  const shapeRow = (node: DNode, depth: number, path: Path, dim: boolean) => {
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
        {...rowDnd(id, path, isCompound ? id : undefined)}
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

  const instanceRow = (node: DNode, depth: number, path: Path, dim: boolean) => {
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
        {...rowDnd(id, path)}
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
  const groupRow = (node: DNode, depth: number, path: Path, dim: boolean) => {
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
        {...rowDnd(gid, path, gid)}
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
            {n.group || n.frame ? (
              <>
                {groupRow(n, depth, path, dim)}
                {!collapsed.has(n.key) &&
                  renderList(
                    n.children!,
                    n.key,
                    depth + 1,
                    path,
                    dim || !!(n.group ?? n.frame)!.hidden
                  )}
              </>
            ) : n.instance ? (
              instanceRow(n, depth, path, dim)
            ) : (
              <>
                {shapeRow(n, depth, path, dim)}
                {n.children && !collapsed.has(n.key) &&
                  renderList(
                    n.children,
                    n.key,
                    depth + 1,
                    path,
                    dim || !!n.shape?.hidden
                  )}
              </>
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
        onPointerLeave={() => setHighlight(null)}
      >
        {roots.length === 0 && <div className="layers-empty">No shapes yet</div>}
        {renderList(roots, null, 0, [], false)}
      </div>
    </div>
  );
}
