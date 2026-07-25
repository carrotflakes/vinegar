import { useMemo, useState } from "react";
import { LuCopy, LuFrame, LuPlus, LuTrash2 } from "react-icons/lu";
import { useEditor } from "../../../store/editorStore";
import { framesInPaintOrder } from "../../../model/scene";
import { openContextMenu } from "../../../store/menuStore";
import { frameMenu } from "../../menus";
import { useTouchDrag } from "../../useTouchDrag";
import "../../Panel.css";
import "../PanelList.css";

/**
 * The document's frames: select, rename, reorder (= export order), add, and
 * delete. Frames are ordinary scene nodes, so this panel drives the normal node
 * actions (select/rename/duplicate/delete) plus frame-specific add/reorder.
 * Reordering is pointer-based (mouse + touch), matching the Layers panel.
 */
export default function FramesPanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const addFrame = useEditor((s) => s.addFrame);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const renameNode = useEditor((s) => s.renameNode);
  const reorderFrame = useEditor((s) => s.reorderFrame);

  const frames = useMemo(() => framesInPaintOrder(doc), [doc]);
  const selected = new Set(selection);

  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const commitDrop = () => {
    if (dragId !== null && dropIndex !== null) reorderFrame(dragId, dropIndex);
    setDragId(null);
    setDropIndex(null);
  };

  const clearDrop = () => {
    setDragId(null);
    setDropIndex(null);
  };

  const startDrag = useTouchDrag<string>({
    onStart: (id) => setDragId(id),
    onMove: (_id, { y, target }) => {
      const rowEl = target?.closest<HTMLElement>("[data-frame-index]");
      if (rowEl) {
        const i = Number(rowEl.dataset.frameIndex);
        const r = rowEl.getBoundingClientRect();
        const after = (y - r.top) / r.height >= 0.5;
        setDropIndex(i + (after ? 1 : 0));
        return;
      }
      if (target?.closest(".layers-list")) {
        setDropIndex(frames.length);
        return;
      }
      setDropIndex(null);
    },
    onDrop: () => commitDrop(),
    onCancel: clearDrop,
  });

  return (
    <div className="layers">
      <div className="panel-title layers-title">
        <span>Frames</span>
        <button
          className="layer-icon-btn title-add"
          title="Add frame"
          onClick={() => addFrame()}
        >
          <LuPlus />
        </button>
      </div>
      <div className="layers-list">
        {frames.length === 0 && (
          <div className="layers-empty">No frames yet</div>
        )}
        {frames.map((frame, i) => (
          <div key={frame.id}>
            {dropIndex === i && dragId !== null && (
              <div className="drop-line-flow" style={{ marginLeft: 6 }} />
            )}
            <div
              className={"layer-row" + (selected.has(frame.id) ? " selected" : "")}
              data-frame-index={i}
              onPointerDown={
                editing === frame.id ? undefined : (e) => startDrag(e, frame.id)
              }
              onClick={() => setSelection([frame.id])}
              onContextMenu={(e) => {
                e.preventDefault();
                setSelection([frame.id]);
                openContextMenu(e.clientX, e.clientY, frameMenu());
              }}
            >
              <span
                className="layer-type"
                aria-hidden
                style={{
                  color: frame.background ?? undefined,
                }}
              >
                <LuFrame />
              </span>
              {editing === frame.id ? (
                <input
                  className="layer-name-input"
                  autoFocus
                  defaultValue={frame.name}
                  onBlur={(e) => {
                    renameNode(frame.id, e.target.value);
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span
                  className="layer-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditing(frame.id);
                  }}
                >
                  {frame.name}
                </span>
              )}
              <span className="layer-count">
                {Math.round(frame.width)}×{Math.round(frame.height)}
              </span>
              <button
                className="layer-icon-btn"
                title="Duplicate frame"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelection([frame.id]);
                  duplicateSelected();
                }}
              >
                <LuCopy />
              </button>
              <button
                className="layer-icon-btn"
                title="Delete frame"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelection([frame.id]);
                  deleteSelected();
                }}
              >
                <LuTrash2 />
              </button>
            </div>
          </div>
        ))}
        {dropIndex === frames.length && dragId !== null && (
          <div className="drop-line-flow" style={{ marginLeft: 6 }} />
        )}
      </div>
    </div>
  );
}
