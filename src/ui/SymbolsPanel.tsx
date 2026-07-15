import { useState } from "react";
import { LuComponent, LuPlus, LuPencil, LuTrash2 } from "react-icons/lu";
import { instanceIdsOf } from "../model/scene";
import { screenToWorld } from "../model/viewport";
import { currentSymbolScope, useEditor } from "../store/editorStore";
import "./Panel.css";
import "./LayersPanel.css";

/** World point at the center of the canvas, for placing new instances. */
function canvasCenterWorld() {
  const state = useEditor.getState();
  const el = document.querySelector(".canvas-wrap");
  const r = el?.getBoundingClientRect();
  const screen = r
    ? { x: r.width / 2, y: r.height / 2 }
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  return screenToWorld(state.viewport, screen);
}

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

  return (
    <div className="symbols-panel">
      <div className="panel-title layers-title">Symbols</div>
      <div className="symbols-list">
        {symbols.length === 0 ? (
          <div className="layers-empty">No symbols yet</div>
        ) : (
          symbols.map((def) => {
            const count = instanceIdsOf(doc, def.id).length;
            return (
              <div
                key={def.id}
                className={"symbol-row" + (scope === def.id ? " selected" : "")}
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
                    placeSymbolInstance(def.id, canvasCenterWorld())
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
