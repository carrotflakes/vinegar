import { useState } from "react";
import { LuFrame, LuPlus, LuTrash2 } from "react-icons/lu";
import { useEditor } from "../store/editorStore";
import "./Panel.css";
import "./LayersPanel.css";

/**
 * The document's artboards: select, rename, reorder (= export order), add, and
 * delete. Reordering is plain HTML5 drag-and-drop, matching the Layers panel.
 */
export default function ArtboardsPanel() {
  const artboards = useEditor((s) => s.doc.artboards);
  const selectedId = useEditor((s) => s.selectedArtboardId);
  const selectArtboard = useEditor((s) => s.selectArtboard);
  const addArtboard = useEditor((s) => s.addArtboard);
  const deleteArtboard = useEditor((s) => s.deleteArtboard);
  const updateArtboard = useEditor((s) => s.updateArtboard);
  const reorderArtboard = useEditor((s) => s.reorderArtboard);

  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const commitDrop = () => {
    if (dragId !== null && dropIndex !== null) reorderArtboard(dragId, dropIndex);
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <div className="layers">
      <div className="panel-title layers-title">
        <span>Artboards</span>
        <button
          className="layer-icon-btn title-add"
          title="Add artboard"
          onClick={() => addArtboard()}
        >
          <LuPlus />
        </button>
      </div>
      <div
        className="layers-list"
        onDragOver={(e) => {
          if (dragId === null || e.target !== e.currentTarget) return;
          e.preventDefault();
          setDropIndex(artboards.length);
        }}
        onDrop={(e) => {
          e.preventDefault();
          commitDrop();
        }}
      >
        {artboards.length === 0 && (
          <div className="layers-empty">No artboards yet</div>
        )}
        {artboards.map((ab, i) => (
          <div key={ab.id}>
            {dropIndex === i && dragId !== null && (
              <div className="drop-line-flow" style={{ marginLeft: 6 }} />
            )}
            <div
              className={"layer-row" + (selectedId === ab.id ? " selected" : "")}
              draggable={editing !== ab.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", ab.id);
                setDragId(ab.id);
              }}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const after = (e.clientY - r.top) / r.height >= 0.5;
                setDropIndex(i + (after ? 1 : 0));
              }}
              onDrop={(e) => {
                e.preventDefault();
                commitDrop();
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropIndex(null);
              }}
              onClick={() => selectArtboard(ab.id)}
            >
              <span
                className="layer-type"
                aria-hidden
                style={{
                  color: ab.background ?? undefined,
                }}
              >
                <LuFrame />
              </span>
              {editing === ab.id ? (
                <input
                  className="layer-name-input"
                  autoFocus
                  defaultValue={ab.name}
                  onBlur={(e) => {
                    updateArtboard(ab.id, { name: e.target.value });
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
                    setEditing(ab.id);
                  }}
                >
                  {ab.name}
                </span>
              )}
              <span className="layer-count">
                {Math.round(ab.width)}×{Math.round(ab.height)}
              </span>
              <button
                className="layer-icon-btn"
                title="Delete artboard"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteArtboard(ab.id);
                }}
              >
                <LuTrash2 />
              </button>
            </div>
          </div>
        ))}
        {dropIndex === artboards.length && dragId !== null && (
          <div className="drop-line-flow" style={{ marginLeft: 6 }} />
        )}
      </div>
    </div>
  );
}
