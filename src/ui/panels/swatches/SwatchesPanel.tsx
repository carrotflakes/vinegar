import { useMemo, useState } from "react";
import { LuPaintBucket, LuPlus, LuSquarePen, LuTrash2 } from "react-icons/lu";
import { paintToCss, solid } from "../../../model/paint";
import { swatchUsageCounts } from "../../../model/swatches";
import { useEditor } from "../../../store/editorStore";
import "../../Panel.css";
import "../PanelList.css";
import "./SwatchesPanel.css";

/**
 * The document's global colours ("document colours"): named solid paints that
 * nodes reference by id, so editing one re-tints every use live. Rows show a
 * colour chip (edit live), an editable name and a usage count; the apply
 * buttons link the selection's fill/stroke to the swatch. Deleting bakes every
 * reference to its concrete colour first, so nothing dangles.
 */
export default function SwatchesPanel() {
  const doc = useEditor((s) => s.doc);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  const styleFill = useEditor((s) => s.style.fill);
  const createSwatch = useEditor((s) => s.createSwatch);
  const createSwatchFromSelection = useEditor((s) => s.createSwatchFromSelection);
  const updateSwatch = useEditor((s) => s.updateSwatch);
  const applySwatch = useEditor((s) => s.applySwatch);
  const deleteSwatch = useEditor((s) => s.deleteSwatch);
  const [editing, setEditing] = useState<string | null>(null);

  const counts = useMemo(() => swatchUsageCounts(doc), [doc]);

  // New color: from the selection's fill when something is selected (linking it
  // to the new swatch), otherwise a standalone swatch seeded from the current
  // fill style. Either way the button always does something.
  const addColor = () =>
    hasSelection
      ? createSwatchFromSelection()
      : createSwatch("", styleFill?.type === "solid" ? styleFill : solid("#4f8cff"));

  const remove = (id: string, name: string, count: number) => {
    if (count > 0 && !window.confirm(
      `Delete “${name}”? ${count} object${count > 1 ? "s" : ""} will keep the current color.`
    )) return;
    deleteSwatch(id);
  };

  return (
    <div className="symbols-panel">
      <div className="panel-title layers-title">
        <span>Global colors</span>
        <button
          className="layer-icon-btn title-add"
          title={hasSelection ? "New color from selection" : "New color"}
          onClick={addColor}
        >
          <LuPlus />
        </button>
      </div>
      <div className="symbols-list">
        {doc.swatchOrder.length === 0 ? (
          <div className="layers-empty">No global colors yet</div>
        ) : (
          doc.swatchOrder.map((id) => {
            const sw = doc.swatches[id];
            if (!sw) return null;
            const count = counts.get(id) ?? 0;
            return (
              <div key={id} className="swatch-row">
                <label className="swatch-chip" title="Edit color" style={{ background: paintToCss(sw.paint) }}>
                  <input
                    type="color"
                    value={sw.paint.color}
                    onChange={(e) =>
                      updateSwatch(id, { paint: solid(e.target.value, sw.paint.alpha) })
                    }
                  />
                </label>
                {editing === id ? (
                  <input
                    className="layer-name-input"
                    autoFocus
                    defaultValue={sw.name}
                    onBlur={(e) => {
                      updateSwatch(id, { name: e.target.value });
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <span className="layer-name" onDoubleClick={() => setEditing(id)}>
                    {sw.name}
                  </span>
                )}
                <span className="layer-count" title={`Used ${count}×`}>
                  {count}
                </span>
                <button
                  className="layer-icon-btn"
                  title="Apply to selection fill"
                  disabled={!hasSelection}
                  onClick={() => applySwatch(id, "fill")}
                >
                  <LuPaintBucket />
                </button>
                <button
                  className="layer-icon-btn"
                  title="Apply to selection stroke"
                  disabled={!hasSelection}
                  onClick={() => applySwatch(id, "stroke")}
                >
                  <LuSquarePen />
                </button>
                <button
                  className="layer-icon-btn"
                  title="Delete color"
                  onClick={() => remove(id, sw.name, count)}
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
