import { useMemo, useState } from "react";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { paramUsageCounts } from "@/model/params";
import { useEditor } from "@/store/editorStore";
import ScrubbableNumber from "../../controls/ScrubbableNumber";
import "../../Panel.css";
import "../PanelList.css";
import "./ParamsPanel.css";

/**
 * The document's parameters ("global numbers"): named values that node number
 * fields bind to, so editing one retunes every bound field live. Rows show an
 * editable name, the value (scrubbable) and how many fields it drives; deleting
 * detaches every binding first, so nothing dangles and nothing moves.
 *
 * A parameter edit rewrites every bound node, so scrubbing here runs inside one
 * interaction and lands as a single undo step. See docs/parameters.md.
 */
export default function ParamsPanel() {
  const doc = useEditor((s) => s.doc);
  const createParam = useEditor((s) => s.createParam);
  const updateParam = useEditor((s) => s.updateParam);
  const deleteParam = useEditor((s) => s.deleteParam);
  const beginInteraction = useEditor((s) => s.beginInteraction);
  const endInteraction = useEditor((s) => s.endInteraction);
  const cancelInteraction = useEditor((s) => s.cancelInteraction);
  const [editing, setEditing] = useState<string | null>(null);

  const counts = useMemo(() => paramUsageCounts(doc), [doc]);

  const remove = (id: string, name: string, count: number) => {
    if (count > 0 && !window.confirm(
      `Delete “${name}”? ${count} field${count > 1 ? "s" : ""} will keep the current value.`
    )) return;
    deleteParam(id);
  };

  return (
    <div className="symbols-panel">
      <div className="section-title panel-title">
        <span>Parameters</span>
        <button
          className="layer-icon-btn title-add"
          title="New parameter"
          onClick={() => createParam()}
        >
          <LuPlus />
        </button>
      </div>
      <div className="symbols-list">
        {doc.paramOrder.length === 0 ? (
          <div className="layers-empty">
            No parameters yet. Bind a number field to create one.
          </div>
        ) : (
          doc.paramOrder.map((id) => {
            const param = doc.params[id];
            if (!param) return null;
            const count = counts.get(id) ?? 0;
            return (
              <div key={id} className="param-row">
                {editing === id ? (
                  <input
                    className="layer-name-input"
                    autoFocus
                    defaultValue={param.name}
                    onBlur={(e) => {
                      updateParam(id, { name: e.target.value });
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <span className="layer-name" onDoubleClick={() => setEditing(id)}>
                    {param.name}
                  </span>
                )}
                <ScrubbableNumber
                  className="num param-value"
                  value={param.value}
                  min={param.min ?? undefined}
                  {...(param.max !== null ? { max: param.max } : {})}
                  step={param.step ?? (param.integer ? 1 : 0.5)}
                  aria-label={`${param.name} value`}
                  onChange={(value) =>
                    updateParam(id, { value: param.integer ? Math.round(value) : value })
                  }
                  onScrubStart={() => beginInteraction("Edit parameter")}
                  onScrubEnd={endInteraction}
                  onScrubCancel={cancelInteraction}
                />
                <span className="layer-count" title={`Drives ${count} field${count === 1 ? "" : "s"}`}>
                  {count}
                </span>
                <button
                  className="layer-icon-btn"
                  title="Delete parameter"
                  onClick={() => remove(id, param.name, count)}
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
