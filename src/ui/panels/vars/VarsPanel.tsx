import { useMemo, useState } from "react";
import { LuPaintBucket, LuPalette, LuPlus, LuSquarePen, LuTrash2 } from "react-icons/lu";
import { solid } from "@/model/paint";
import { numberValue, paintValue, type DocVar } from "@/model/types";
import { numberVars, paintVars, varUsageCounts } from "@/model/vars";
import { useEditor } from "@/store/editorStore";
import ColorField from "../../controls/ColorField";
import ScrubbableNumber from "../../controls/ScrubbableNumber";
import "../../Panel.css";
import "../PanelList.css";
import "./VarsPanel.css";

/**
 * The document's variables: named colours and numbers in one table. A colour is
 * referenced by a node's fill/stroke and re-tints every use when edited; a
 * number drives every field bound to it. Rows show the value editor, an
 * editable name and a usage count; deleting detaches every use first — paint
 * references bake to their concrete colour, bound fields keep their number — so
 * nothing dangles and nothing moves.
 *
 * A number edit rewrites every bound node, so scrubbing here runs inside one
 * interaction and lands as a single undo step. See docs/parameters.md.
 */
export default function VarsPanel() {
  const doc = useEditor((s) => s.doc);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  const styleFill = useEditor((s) => s.style.fill);
  const createVar = useEditor((s) => s.createVar);
  const createColorVarFromSelection = useEditor((s) => s.createColorVarFromSelection);
  const updateVar = useEditor((s) => s.updateVar);
  const deleteVar = useEditor((s) => s.deleteVar);
  const applyColorVar = useEditor((s) => s.applyColorVar);
  const beginInteraction = useEditor((s) => s.beginInteraction);
  const endInteraction = useEditor((s) => s.endInteraction);
  const cancelInteraction = useEditor((s) => s.cancelInteraction);
  const [editing, setEditing] = useState<string | null>(null);

  const counts = useMemo(() => varUsageCounts(doc), [doc]);
  const colors = useMemo(() => paintVars(doc), [doc]);
  const numbers = useMemo(() => numberVars(doc), [doc]);

  // New colour: from the selection's fill when something is selected (linking
  // it to the new variable), otherwise a standalone one seeded from the current
  // fill style. Either way the button always does something.
  const addColor = () =>
    hasSelection
      ? createColorVarFromSelection()
      : void createVar(
          paintValue(
            styleFill && styleFill.type !== "var" ? styleFill : solid("#4f8cff")
          )
        );

  const remove = (entry: DocVar, count: number) => {
    const noun = entry.value.kind === "paint" ? "object" : "field";
    if (count > 0 && !window.confirm(
      `Delete “${entry.name}”? ${count} ${noun}${count > 1 ? "s" : ""} will keep the current value.`
    )) return;
    deleteVar(entry.id);
  };

  /** The shared name cell: double-click to rename in place. */
  const nameCell = (entry: DocVar) =>
    editing === entry.id ? (
      <input
        className="layer-name-input"
        autoFocus
        defaultValue={entry.name}
        onBlur={(e) => {
          updateVar(entry.id, { name: e.target.value });
          setEditing(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(null);
        }}
      />
    ) : (
      <span className="layer-name" onDoubleClick={() => setEditing(entry.id)}>
        {entry.name}
      </span>
    );

  return (
    <div className="symbols-panel">
      <div className="section-title layers-title">
        <span>Variables</span>
        <button
          className="layer-icon-btn title-add"
          title={hasSelection ? "New color from selection" : "New color"}
          onClick={addColor}
        >
          <LuPalette />
        </button>
        <button
          className="layer-icon-btn title-add"
          title="New number"
          onClick={() => void createVar(numberValue(0))}
        >
          <LuPlus />
        </button>
      </div>
      <div className="symbols-list">
        {colors.length === 0 && numbers.length === 0 && (
          <div className="layers-empty">
            No variables yet. Add a color, or bind a number field to create one.
          </div>
        )}
        {colors.length > 0 && <div className="vars-group-title">Colors</div>}
        {colors.map((entry) => {
          if (entry.value.kind !== "paint") return null;
          const count = counts.get(entry.id) ?? 0;
          return (
            <div key={entry.id} className="swatch-row">
              <ColorField
                variant="swatch"
                label={`Edit “${entry.name}”`}
                value={entry.value.value}
                onChange={(paint) =>
                  // The variable editor never yields null or a reference.
                  paint && paint.type !== "var" &&
                  updateVar(entry.id, { value: paintValue(paint) })
                }
              />
              {nameCell(entry)}
              <span className="layer-count" title={`Used ${count}×`}>
                {count}
              </span>
              <button
                className="layer-icon-btn"
                title="Apply to selection fill"
                disabled={!hasSelection}
                onClick={() => applyColorVar(entry.id, "fill")}
              >
                <LuPaintBucket />
              </button>
              <button
                className="layer-icon-btn"
                title="Apply to selection stroke"
                disabled={!hasSelection}
                onClick={() => applyColorVar(entry.id, "stroke")}
              >
                <LuSquarePen />
              </button>
              <button
                className="layer-icon-btn"
                title="Delete variable"
                onClick={() => remove(entry, count)}
              >
                <LuTrash2 />
              </button>
            </div>
          );
        })}
        {numbers.length > 0 && <div className="vars-group-title">Numbers</div>}
        {numbers.map((entry) => {
          const value = entry.value;
          if (value.kind !== "number") return null;
          const count = counts.get(entry.id) ?? 0;
          return (
            <div key={entry.id} className="param-row">
              {nameCell(entry)}
              <ScrubbableNumber
                className="num param-value"
                value={value.value}
                min={value.min ?? undefined}
                {...(value.max !== null ? { max: value.max } : {})}
                step={value.step ?? (value.integer ? 1 : 0.5)}
                aria-label={`${entry.name} value`}
                onChange={(next) =>
                  updateVar(entry.id, {
                    value: { ...value, value: value.integer ? Math.round(next) : next },
                  })
                }
                onScrubStart={() => beginInteraction("Edit variable")}
                onScrubEnd={endInteraction}
                onScrubCancel={cancelInteraction}
              />
              <span
                className="layer-count"
                title={`Drives ${count} field${count === 1 ? "" : "s"}`}
              >
                {count}
              </span>
              <button
                className="layer-icon-btn"
                title="Delete variable"
                onClick={() => remove(entry, count)}
              >
                <LuTrash2 />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
