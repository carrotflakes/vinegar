import { isAreal } from "../model/boolean";
import { shapeBounds } from "../model/bounds";
import type { Shape } from "../model/types";
import { useEditor } from "../store/editorStore";
import ColorField from "./ColorField";

export default function PropertiesPanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const style = useEditor((s) => s.style);
  const updateSelectedStyle = useEditor((s) => s.updateSelectedStyle);
  const setStyle = useEditor((s) => s.setStyle);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const bringToFront = useEditor((s) => s.bringToFront);
  const sendToBack = useEditor((s) => s.sendToBack);
  const groupSelected = useEditor((s) => s.groupSelected);
  const ungroupSelected = useEditor((s) => s.ungroupSelected);
  const alignSelected = useEditor((s) => s.alignSelected);
  const distributeSelected = useEditor((s) => s.distributeSelected);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const booleanSelected = useEditor((s) => s.booleanSelected);
  const setClosedSelected = useEditor((s) => s.setClosedSelected);

  const selected = selection
    .map((id) => doc.shapes[id])
    .filter(Boolean) as Shape[];
  const hasSelection = selected.length > 0;
  const first = selected[0];
  const canGroup = selected.length >= 2;
  const canUngroup = selected.some((s) => s.groupId);
  const canBoolean = selected.filter(isAreal).length >= 2;
  const closable = selected.filter(
    (s) => s.type === "path" || s.type === "bezier"
  );
  const anyOpen = closable.some((s) => "closed" in s && !s.closed);

  // Effective values: selected shape's values, else the new-shape defaults.
  const fill = hasSelection ? first.fill : style.fill;
  const stroke = hasSelection ? first.stroke : style.stroke;
  const strokeWidth = hasSelection ? first.strokeWidth : style.strokeWidth;
  const opacity = hasSelection ? first.opacity : 1;

  const setFill = (v: string | null) =>
    hasSelection ? updateSelectedStyle({ fill: v }) : setStyle({ fill: v });
  const setStroke = (v: string | null) =>
    hasSelection ? updateSelectedStyle({ stroke: v }) : setStyle({ stroke: v });
  const setStrokeWidth = (v: number) =>
    hasSelection
      ? updateSelectedStyle({ strokeWidth: v })
      : setStyle({ strokeWidth: v });

  return (
    <div className="panel">
      <div className="panel-section">
        <div className="panel-title">
          {hasSelection
            ? selected.length === 1
              ? typeName(first)
              : `${selected.length} selected`
            : "New shape defaults"}
        </div>

        <ColorField label="Fill" value={fill} onChange={setFill} />
        <ColorField label="Stroke" value={stroke} onChange={setStroke} />

        <div className="field">
          <label>Stroke width</label>
          <div className="field-row">
            <input
              type="range"
              min={0}
              max={40}
              step={0.5}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
            />
            <input
              type="number"
              className="num"
              min={0}
              step={0.5}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
            />
          </div>
        </div>

        {hasSelection && (
          <div className="field">
            <label>Opacity</label>
            <div className="field-row">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={opacity}
                onChange={(e) =>
                  updateSelectedStyle({ opacity: Number(e.target.value) })
                }
              />
              <span className="num readout">{Math.round(opacity * 100)}%</span>
            </div>
          </div>
        )}

        {selected.length === 1 && (
          <div className="field">
            <label>Rotation</label>
            <div className="field-row">
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={Math.round((first.rotation * 180) / Math.PI)}
                onChange={(e) =>
                  updateSelectedStyle({
                    rotation: (Number(e.target.value) * Math.PI) / 180,
                  })
                }
              />
              <input
                type="number"
                className="num"
                step={1}
                value={Math.round((first.rotation * 180) / Math.PI)}
                onChange={(e) =>
                  updateSelectedStyle({
                    rotation: (Number(e.target.value) * Math.PI) / 180,
                  })
                }
              />
            </div>
          </div>
        )}
      </div>

      {hasSelection && (
        <div className="panel-section">
          <div className="panel-title">Arrange</div>
          <div className="btn-row">
            <button className="ghost-btn" onClick={bringToFront}>
              Bring to front
            </button>
            <button className="ghost-btn" onClick={sendToBack}>
              Send to back
            </button>
          </div>
          {(canGroup || canUngroup) && (
            <div className="btn-row">
              <button
                className="ghost-btn"
                disabled={!canGroup}
                onClick={groupSelected}
              >
                Group
              </button>
              <button
                className="ghost-btn"
                disabled={!canUngroup}
                onClick={ungroupSelected}
              >
                Ungroup
              </button>
            </div>
          )}
          {closable.length > 0 && (
            <div className="btn-row">
              <button
                className="ghost-btn"
                onClick={() => setClosedSelected(anyOpen)}
              >
                {anyOpen ? "Close path" : "Open path"}
              </button>
            </div>
          )}
          <div className="btn-row">
            <button className="ghost-btn" onClick={duplicateSelected}>
              Duplicate
            </button>
            <button className="ghost-btn danger" onClick={deleteSelected}>
              Delete
            </button>
          </div>
          {selected.length === 1 && <Geometry shape={first} />}
        </div>
      )}

      {selected.length >= 2 && (
        <div className="panel-section">
          <div className="panel-title">Align</div>
          <div className="btn-row">
            <button className="ghost-btn align-btn" title="Align left" onClick={() => alignSelected("left")}>⇤</button>
            <button className="ghost-btn align-btn" title="Align horizontal centers" onClick={() => alignSelected("hcenter")}>⇔</button>
            <button className="ghost-btn align-btn" title="Align right" onClick={() => alignSelected("right")}>⇥</button>
          </div>
          <div className="btn-row">
            <button className="ghost-btn align-btn" title="Align top" onClick={() => alignSelected("top")}>⤒</button>
            <button className="ghost-btn align-btn" title="Align vertical centers" onClick={() => alignSelected("vmiddle")}>⇕</button>
            <button className="ghost-btn align-btn" title="Align bottom" onClick={() => alignSelected("bottom")}>⤓</button>
          </div>
          <div className="btn-row">
            <button
              className="ghost-btn"
              disabled={selected.length < 3}
              title="Distribute horizontally"
              onClick={() => distributeSelected("h")}
            >
              Dist H
            </button>
            <button
              className="ghost-btn"
              disabled={selected.length < 3}
              title="Distribute vertically"
              onClick={() => distributeSelected("v")}
            >
              Dist V
            </button>
          </div>
        </div>
      )}

      {canBoolean && (
        <div className="panel-section">
          <div className="panel-title">Boolean</div>
          <div className="btn-row">
            <button className="ghost-btn" onClick={() => booleanSelected("union")}>
              Union
            </button>
            <button
              className="ghost-btn"
              onClick={() => booleanSelected("subtract")}
            >
              Subtract
            </button>
          </div>
          <div className="btn-row">
            <button
              className="ghost-btn"
              onClick={() => booleanSelected("intersect")}
            >
              Intersect
            </button>
            <button className="ghost-btn" onClick={() => booleanSelected("xor")}>
              Exclude
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Geometry({ shape }: { shape: Shape }) {
  const setShapeGeometry = useEditor((s) => s.setShapeGeometry);
  const b = shapeBounds(shape);

  const field = (key: "x" | "y" | "width" | "height", label: string) => {
    const v = Math.round(b[key]);
    return (
      <label className="geo-field">
        <span>{label}</span>
        <input
          type="number"
          key={`${key}:${v}`}
          defaultValue={v}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (e.target.value !== "" && !Number.isNaN(n)) {
              setShapeGeometry(shape.id, { [key]: n });
            }
          }}
        />
      </label>
    );
  };

  return (
    <div className="geometry-grid">
      {field("x", "X")}
      {field("y", "Y")}
      {field("width", "W")}
      {field("height", "H")}
    </div>
  );
}

function typeName(shape: Shape): string {
  switch (shape.type) {
    case "rect":
      return "Rectangle";
    case "ellipse":
      return "Ellipse";
    case "line":
      return "Line";
    case "path":
      return "Path";
    case "bezier":
      return "Curve";
    case "polygon":
      return "Shape";
  }
}
