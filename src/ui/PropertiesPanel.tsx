import { isAreal } from "../model/boolean";
import { shapeBounds } from "../model/bounds";
import {
  applyMatrix,
  matrixAngle,
  multiply,
  rotationAbout,
} from "../model/matrix";
import {
  canGroupSelection,
  exactlySelectedGroup,
  selectionUnits,
} from "../model/groups";
import { BLEND_MODES, type BlendMode, type Shape } from "../model/types";
import { useEditor } from "../store/editorStore";
import ColorField from "./ColorField";
import { getSelectionFrame } from "../canvas/frame";

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
  const updateGroupStyle = useEditor((s) => s.updateGroupStyle);
  const alignSelected = useEditor((s) => s.alignSelected);
  const distributeSelected = useEditor((s) => s.distributeSelected);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const booleanSelected = useEditor((s) => s.booleanSelected);
  const setClosedSelected = useEditor((s) => s.setClosedSelected);
  const outlineStrokeSelected = useEditor((s) => s.outlineStrokeSelected);

  const selected = selection
    .map((id) => doc.shapes[id])
    .filter(Boolean) as Shape[];
  const hasSelection = selected.length > 0;
  const first = selected[0];
  const canGroup = canGroupSelection(doc, selection);
  const canUngroup = selectionUnits(doc, selection).groups.length > 0;
  const selectedGroup = exactlySelectedGroup(doc, selection);
  const canBoolean = selected.filter(isAreal).length >= 2;
  const closable = selected.filter(
    (s) => s.type === "path" || s.type === "bezier"
  );
  const anyOpen = closable.some((s) => "closed" in s && !s.closed);
  const canOutline = selected.some(
    (s) => s.stroke !== null && s.strokeWidth > 0
  );

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
  const rotationDeg = hasSelection
    ? Math.round((matrixAngle(first.transform) * 180) / Math.PI)
    : 0;
  const setRotation = (degrees: number) => {
    const bounds = shapeBounds(first);
    const localCenter = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    const pivot = applyMatrix(first.transform, localCenter);
    const target = (degrees * Math.PI) / 180;
    const delta = target - matrixAngle(first.transform);
    updateSelectedStyle({
      transform: multiply(rotationAbout(pivot, delta), first.transform),
    });
  };
  const groupRotationDeg = selectedGroup
    ? Math.round((matrixAngle(selectedGroup.transform) * 180) / Math.PI)
    : 0;
  const setGroupRotation = (degrees: number) => {
    if (!selectedGroup) return;
    const frame = getSelectionFrame(doc, selected, selectedGroup);
    if (!frame) return;
    const localCenter = {
      x: frame.bounds.x + frame.bounds.width / 2,
      y: frame.bounds.y + frame.bounds.height / 2,
    };
    const pivot = applyMatrix(selectedGroup.transform, localCenter);
    const target = (degrees * Math.PI) / 180;
    const delta = target - matrixAngle(selectedGroup.transform);
    updateGroupStyle(selectedGroup.id, {
      transform: multiply(
        rotationAbout(pivot, delta),
        selectedGroup.transform
      ),
    });
  };

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

        {hasSelection && (
          <div className="field">
            <label>Blend mode</label>
            <select
              className="blend-select"
              value={first.blendMode ?? "normal"}
              onChange={(e) => {
                const v = e.target.value as BlendMode;
                updateSelectedStyle({
                  blendMode: v === "normal" ? undefined : v,
                });
              }}
            >
              {BLEND_MODES.map((m) => (
                <option key={m} value={m}>
                  {blendLabel(m)}
                </option>
              ))}
            </select>
          </div>
        )}

        {selected.length === 1 && !selectedGroup && (
          <div className="field">
            <label>Rotation</label>
            <div className="field-row">
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={rotationDeg}
                onChange={(e) => setRotation(Number(e.target.value))}
              />
              <input
                type="number"
                className="num"
                step={1}
                value={rotationDeg}
                onChange={(e) => setRotation(Number(e.target.value))}
              />
            </div>
          </div>
        )}
      </div>

      {selectedGroup && (
        <div className="panel-section">
          <div className="panel-title">Group “{selectedGroup.name}”</div>
          <div className="field">
            <label>Group opacity</label>
            <div className="field-row">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedGroup.opacity ?? 1}
                onChange={(e) =>
                  updateGroupStyle(selectedGroup.id, {
                    opacity: Number(e.target.value),
                  })
                }
              />
              <span className="num readout">
                {Math.round((selectedGroup.opacity ?? 1) * 100)}%
              </span>
            </div>
          </div>
          <div className="field">
            <label>Group rotation</label>
            <div className="field-row">
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={groupRotationDeg}
                onChange={(e) => setGroupRotation(Number(e.target.value))}
              />
              <input
                type="number"
                className="num"
                step={1}
                value={groupRotationDeg}
                onChange={(e) => setGroupRotation(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="field">
            <label>Group blend mode</label>
            <select
              className="blend-select"
              value={selectedGroup.blendMode ?? "normal"}
              onChange={(e) => {
                const v = e.target.value as BlendMode;
                updateGroupStyle(selectedGroup.id, {
                  blendMode: v === "normal" ? undefined : v,
                });
              }}
            >
              {BLEND_MODES.map((m) => (
                <option key={m} value={m}>
                  {blendLabel(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

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
          {canOutline && (
            <div className="btn-row">
              <button
                className="ghost-btn"
                title="Convert stroke to a filled path"
                onClick={outlineStrokeSelected}
              >
                Outline stroke
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

function blendLabel(mode: BlendMode): string {
  const words = mode.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
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
