import { useState } from "react";
import { LuCode, LuFilePlus, LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";
import { canvasCenterPlacement } from "../../../canvas/canvasDrag";
import { useEditor } from "../../../store/editorStore";
import { useUi } from "../../../store/uiStore";
import { NEW_SCRIPT_SOURCE } from "../../dialogs/GeneratorsDialog";
import "../../Panel.css";
import "../PanelList.css";

/**
 * The document's parametric generator scripts: rename, insert an instance, edit
 * the source (in the Generators dialog), or delete. Built-in generators live in
 * the dialog; this panel manages the user-authored scripts in `doc.scripts`,
 * mirroring the Symbols panel.
 */
export default function GeneratorsPanel() {
  const scripts = useEditor((s) => s.doc.scripts);
  const trusted = useEditor((s) => s.scriptsTrusted);
  const insertGenerator = useEditor((s) => s.insertGenerator);
  const updateScript = useEditor((s) => s.updateScript);
  const deleteScript = useEditor((s) => s.deleteScript);
  const addScript = useEditor((s) => s.addScript);
  const trustScripts = useEditor((s) => s.trustScripts);
  const openGenerators = useUi((s) => s.openGenerators);
  const [editing, setEditing] = useState<string | null>(null);

  const list = Object.values(scripts);

  const createNew = () => {
    const id = addScript("Untitled generator", NEW_SCRIPT_SOURCE);
    openGenerators(id);
  };

  return (
    <div className="layers">
      <div className="panel-title layers-title">
        Generators
        <button
          className="layer-icon-btn title-add"
          title="New generator"
          onClick={createNew}
        >
          <LuFilePlus />
        </button>
      </div>

      {!trusted && (
        <button
          className="layers-scope"
          onClick={trustScripts}
          title="Run this document's generators"
        >
          Generators disabled — enable
        </button>
      )}

      <div className="layers-list">
        {list.length === 0 ? (
          <div className="layers-empty">No generators yet</div>
        ) : (
          list.map((def) => (
            <div key={def.id} className="layer-row">
              <span className="layer-type" aria-hidden>
                <LuCode />
              </span>
              {editing === def.id ? (
                <input
                  className="layer-name-input"
                  autoFocus
                  defaultValue={def.name}
                  onBlur={(e) => {
                    updateScript(def.id, { name: e.target.value });
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
              <button
                className="layer-icon-btn"
                title={trusted ? "Insert" : "Enable generators to insert"}
                disabled={!trusted}
                onClick={() =>
                  insertGenerator(def.id, canvasCenterPlacement().at)
                }
              >
                <LuPlus />
              </button>
              <button
                className="layer-icon-btn"
                title="Edit source"
                onClick={() => openGenerators(def.id)}
              >
                <LuPencil />
              </button>
              <button
                className="layer-icon-btn"
                title="Delete generator"
                onClick={() => deleteScript(def.id)}
              >
                <LuTrash2 />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
