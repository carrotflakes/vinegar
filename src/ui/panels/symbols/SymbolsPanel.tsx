import { useMemo, useState } from "react";
import { LuComponent, LuPlus, LuPencil, LuTrash2 } from "react-icons/lu";
import { instanceCountsBySymbol } from "../../../model/scene";
import { currentSymbolScope, useEditor } from "../../../store/editorStore";
import { DRAG_SYMBOL, canvasCenterPlacement } from "../../canvasDrag";
import "../../Panel.css";
import "../layers/LayersPanel.css";

/**
 * The document's reusable symbols: rename, place an instance, jump into local
 * edit, or delete (once no instances reference it). Split out of the Layers
 * panel so it can live in its own dock tab.
 */
export default function SymbolsPanel() {
  const doc = useEditor((s) => s.doc);
  const scope = useEditor((s) => currentSymbolScope(s));
  const enterSymbolEdit = useEditor((s) => s.enterSymbolEdit);
  const placeSymbolInstance = useEditor((s) => s.placeSymbolInstance);
  const renameSymbol = useEditor((s) => s.renameSymbol);
  const deleteSymbol = useEditor((s) => s.deleteSymbol);
  const [editing, setEditing] = useState<string | null>(null);

  const symbols = Object.values(doc.symbols);
  // One scan for every row's instance count, recomputed only when `doc` changes.
  const instanceCounts = useMemo(() => instanceCountsBySymbol(doc), [doc]);

  return (
    <div className="symbols-panel">
      <div className="panel-title layers-title">Symbols</div>
      <div className="symbols-list">
        {symbols.length === 0 ? (
          <div className="layers-empty">No symbols yet</div>
        ) : (
          symbols.map((def) => {
            const count = instanceCounts.get(def.id) ?? 0;
            return (
              <div
                key={def.id}
                className={"symbol-row" + (scope === def.id ? " selected" : "")}
                draggable={editing !== def.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_SYMBOL, def.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                <span className="layer-type" aria-hidden>
                  <LuComponent />
                </span>
                {editing === def.id ? (
                  <input
                    className="layer-name-input"
                    autoFocus
                    defaultValue={def.name}
                    onBlur={(e) => {
                      renameSymbol(def.id, e.target.value);
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
                    onDoubleClick={() => setEditing(def.id)}
                  >
                    {def.name}
                  </span>
                )}
                <span className="layer-count">{count}</span>
                <button
                  className="layer-icon-btn"
                  title="Place instance"
                  onClick={() =>
                    placeSymbolInstance(def.id, canvasCenterPlacement().at)
                  }
                >
                  <LuPlus />
                </button>
                <button
                  className="layer-icon-btn"
                  title="Edit symbol"
                  onClick={() => enterSymbolEdit(def.id)}
                >
                  <LuPencil />
                </button>
                <button
                  className="layer-icon-btn"
                  title={
                    count > 0 ? "Delete (remove instances first)" : "Delete symbol"
                  }
                  disabled={count > 0 || scope === def.id}
                  onClick={() => deleteSymbol(def.id)}
                >
                  <LuTrash2 />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
