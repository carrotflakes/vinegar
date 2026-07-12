import {
  LuAlignStartVertical,
  LuAlignCenterVertical,
  LuAlignEndVertical,
  LuAlignStartHorizontal,
  LuAlignCenterHorizontal,
  LuAlignEndHorizontal,
  LuAlignHorizontalDistributeCenter,
  LuAlignVerticalDistributeCenter,
} from "react-icons/lu";
import { isAreal } from "../model/boolean";
import {
  canMakeCompoundPathSelection,
  canReleaseCompoundPathSelection,
} from "../model/compoundPath";
import { shapeBounds } from "../model/bounds";
import {
  applyMatrix,
  applyWorldTransformToNode,
  matrixAngle,
  nodeWorldMatrix,
  rotationAbout,
  shapeWorldMatrix,
} from "../model/matrix";
import {
  canGroupSelection,
  exactlySelectedGroup,
  selectionUnits,
} from "../model/groups";
import { BLEND_MODES, type BlendMode, type Shape, type SymbolInstance } from "../model/types";
import { descendantShapeIds, isInstance, isShape, selectionRoots } from "../model/scene";
import { useEditor } from "../store/editorStore";
import ColorField from "./ColorField";
import { getSelectionFrame } from "../canvas/frame";

export default function PropertiesPanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const selectionPivot = useEditor((s) => s.selectionPivot);
  const style = useEditor((s) => s.style);
  const updateSelectedStyle = useEditor((s) => s.updateSelectedStyle);
  const setSelectionPivot = useEditor((s) => s.setSelectionPivot);
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
  const makeCompoundPathSelected = useEditor((s) => s.makeCompoundPathSelected);
  const releaseCompoundPathSelected = useEditor((s) => s.releaseCompoundPathSelected);
  const enterSymbolEdit = useEditor((s) => s.enterSymbolEdit);
  const detachSelectedInstances = useEditor((s) => s.detachSelectedInstances);

  const selectionRootIds = selectionRoots(doc, selection);
  const selectedInstance =
    selectionRootIds.length === 1 && isInstance(doc.nodes[selectionRootIds[0]])
      ? (doc.nodes[selectionRootIds[0]] as SymbolInstance)
      : null;
  const selectedIds = selectionRoots(doc, selection).flatMap((id) =>
    isShape(doc.nodes[id]) ? [id] : descendantShapeIds(doc, id)
  );
  const selected = selectedIds.map((id) => doc.nodes[id]).filter(isShape) as Shape[];
  const hasSelection = selected.length > 0;
  const first = selected[0];
  const canGroup = canGroupSelection(doc, selection);
  const canUngroup = selectionUnits(doc, selection).groups.length > 0;
  const selectedGroup = exactlySelectedGroup(doc, selection);
  const canBoolean = !selectedGroup && selected.filter(isAreal).length >= 2;
  const closable = selectedGroup ? [] : selected.filter(
    (s) => s.type === "path" || s.type === "bezier"
  );
  const anyOpen = closable.some((s) =>
    s.type === "path"
      ? !s.closed
      : s.type === "bezier" && s.subpaths.some((sp) => !sp.closed)
  );
  const canOutline = !selectedGroup && selected.some(
    (s) => s.stroke !== null && s.strokeWidth > 0
  );
  const canMakeCompound = canMakeCompoundPathSelection(doc, selection);
  const canReleaseCompound = canReleaseCompoundPathSelection(doc, selection);

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
    ? Math.round((matrixAngle(shapeWorldMatrix(doc, first)) * 180) / Math.PI)
    : 0;
  const setRotation = (degrees: number) => {
    const bounds = shapeBounds(first);
    const localOrigin = first.transformOrigin ?? {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    const world = shapeWorldMatrix(doc, first);
    const pivot = applyMatrix(world, localOrigin);
    const target = (degrees * Math.PI) / 180;
    const delta = target - matrixAngle(world);
    updateSelectedStyle({
      transform: applyWorldTransformToNode(
        doc,
        first,
        rotationAbout(pivot, delta)
      ).transform,
    });
  };
  const groupRotationDeg = selectedGroup
    ? Math.round((matrixAngle(nodeWorldMatrix(doc, selectedGroup.id)) * 180) / Math.PI)
    : 0;
  const setGroupRotation = (degrees: number) => {
    if (!selectedGroup) return;
    const frame = getSelectionFrame(doc, selected, selectedGroup);
    if (!frame) return;
    const localCenter = selectedGroup.transformOrigin ?? {
      x: frame.bounds.x + frame.bounds.width / 2,
      y: frame.bounds.y + frame.bounds.height / 2,
    };
    const world = nodeWorldMatrix(doc, selectedGroup.id);
    const pivot = applyMatrix(world, localCenter);
    const target = (degrees * Math.PI) / 180;
    const delta = target - matrixAngle(world);
    updateGroupStyle(selectedGroup.id, {
      transform: applyWorldTransformToNode(
        doc,
        selectedGroup,
        rotationAbout(pivot, delta)
      ).transform,
    });
  };

  return (
    <div className="panel">
      {selectedInstance && (
        <div className="panel-section">
          <div className="panel-title">Symbol instance</div>
          <div className="field">
            <label>Symbol</label>
            <div className="field-row">
              <span className="readout instance-symbol-name">
                {doc.symbols[selectedInstance.symbolId]?.name ?? "Missing symbol"}
              </span>
            </div>
          </div>
          <div className="btn-row">
            <button
              className="ghost-btn"
              onClick={() => enterSymbolEdit(selectedInstance.symbolId)}
            >
              Edit symbol
            </button>
            <button className="ghost-btn" onClick={detachSelectedInstances}>
              Detach
            </button>
          </div>
        </div>
      )}
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
            <button
              className="ghost-btn"
              disabled={first.transformOrigin === null}
              onClick={() => updateSelectedStyle({ transformOrigin: null })}
            >
              Reset rotation center
            </button>
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
            <button
              className="ghost-btn"
              disabled={selectedGroup.transformOrigin === null}
              onClick={() =>
                updateGroupStyle(selectedGroup.id, { transformOrigin: null })
              }
            >
              Reset rotation center
            </button>
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

      {selected.length > 1 && !selectedGroup && selectionPivot && (
        <div className="panel-section">
          <div className="panel-title">Transform</div>
          <button
            className="ghost-btn"
            onClick={() => setSelectionPivot(null)}
          >
            Reset rotation center
          </button>
        </div>
      )}

      {(hasSelection || selectedGroup) && (
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
          {(canMakeCompound || canReleaseCompound) && (
            <div className="btn-row">
              {canMakeCompound && (
                <button className="ghost-btn" onClick={makeCompoundPathSelected}>
                  Make compound path
                </button>
              )}
              {canReleaseCompound && (
                <button className="ghost-btn" onClick={releaseCompoundPathSelected}>
                  Release compound path
                </button>
              )}
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
            <button className="ghost-btn align-btn" title="Align left" onClick={() => alignSelected("left")}><LuAlignStartVertical aria-hidden /></button>
            <button className="ghost-btn align-btn" title="Align horizontal centers" onClick={() => alignSelected("hcenter")}><LuAlignCenterVertical aria-hidden /></button>
            <button className="ghost-btn align-btn" title="Align right" onClick={() => alignSelected("right")}><LuAlignEndVertical aria-hidden /></button>
          </div>
          <div className="btn-row">
            <button className="ghost-btn align-btn" title="Align top" onClick={() => alignSelected("top")}><LuAlignStartHorizontal aria-hidden /></button>
            <button className="ghost-btn align-btn" title="Align vertical centers" onClick={() => alignSelected("vmiddle")}><LuAlignCenterHorizontal aria-hidden /></button>
            <button className="ghost-btn align-btn" title="Align bottom" onClick={() => alignSelected("bottom")}><LuAlignEndHorizontal aria-hidden /></button>
          </div>
          <div className="btn-row">
            <button
              className="ghost-btn"
              disabled={selected.length < 3}
              title="Distribute horizontally"
              onClick={() => distributeSelected("h")}
            >
              <LuAlignHorizontalDistributeCenter aria-hidden />
              <span>Dist H</span>
            </button>
            <button
              className="ghost-btn"
              disabled={selected.length < 3}
              title="Distribute vertically"
              onClick={() => distributeSelected("v")}
            >
              <LuAlignVerticalDistributeCenter aria-hidden />
              <span>Dist V</span>
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
    case "compoundPath":
      return "Compound Path";
  }
}
