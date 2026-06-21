import { useState } from "react";
import type { Shape } from "../model/types";
import { expandToGroups, useEditor } from "../store/editorStore";

const TYPE_ICON: Record<Shape["type"], string> = {
  rect: "▭",
  ellipse: "◯",
  line: "╱",
  path: "〜",
  bezier: "✒",
  polygon: "⬟",
};

export default function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const toggleLocked = useEditor((s) => s.toggleLocked);
  const renameShape = useEditor((s) => s.renameShape);
  const setOrder = useEditor((s) => s.setOrder);

  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Front-most shape on top of the list.
  const displayed = [...doc.order].reverse();

  const onRowClick = (id: string, shift: boolean) => {
    if (shift) {
      const group = expandToGroups(doc, [id]);
      const has = group.every((g) => selection.includes(g));
      setSelection(
        has
          ? selection.filter((s) => !group.includes(s))
          : [...new Set([...selection, ...group])]
      );
    } else {
      setSelection(expandToGroups(doc, [id]));
    }
  };

  const commitDrop = () => {
    if (dragId == null || dropIndex == null) {
      setDragId(null);
      setDropIndex(null);
      return;
    }
    const without = displayed.filter((id) => id !== dragId);
    const from = displayed.indexOf(dragId);
    let idx = dropIndex;
    if (from < dropIndex) idx -= 1;
    without.splice(idx, 0, dragId);
    setOrder([...without].reverse());
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <div className="layers">
      <div className="panel-title layers-title">Layers</div>
      <div className="layers-list" onDragLeave={() => setDropIndex(null)}>
        {displayed.length === 0 && (
          <div className="layers-empty">No shapes yet</div>
        )}
        {displayed.map((id, i) => {
          const shape = doc.shapes[id];
          if (!shape) return null;
          const selected = selection.includes(id);
          return (
            <div key={id} className="layer-slot">
              {dropIndex === i && <div className="drop-line" />}
              <div
                className={
                  "layer-row" +
                  (selected ? " selected" : "") +
                  (shape.hidden ? " hidden" : "")
                }
                draggable={editing !== id}
                onDragStart={() => setDragId(id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > r.top + r.height / 2;
                  setDropIndex(after ? i + 1 : i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  commitDrop();
                }}
                onClick={(e) => onRowClick(id, e.shiftKey)}
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
                  <input
                    className="layer-name-input"
                    autoFocus
                    defaultValue={shape.name}
                    onBlur={(e) => {
                      renameShape(id, e.target.value.trim() || shape.name);
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
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
                {shape.groupId && (
                  <span className="layer-group" title="Grouped">
                    ⛓
                  </span>
                )}
              </div>
              {dropIndex === displayed.length && i === displayed.length - 1 && (
                <div className="drop-line drop-line-end" />
              )}
            </div>
          );
        })}
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
