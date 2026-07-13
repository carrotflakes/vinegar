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
import {
  canMakeClippingMaskSelection,
  canReleaseClippingMaskSelection,
  clippingMask,
} from "../model/clippingMask";
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
import type { Paint } from "../model/paint";
import { defaultEffect } from "../model/effects";
import {
  BLEND_MODES,
  type Artboard,
  type BlendMode,
  type DropShadowEffect,
  type Effect,
  type SceneNode,
  type Shape,
  type StrokeAlignment,
  type StrokeCap,
  type StrokeJoin,
  type SymbolInstance,
  type TextShape,
} from "../model/types";
import {
  effectiveStrokeAlignment,
  normalizeStrokeDash,
  strokeCap as resolvedStrokeCap,
  strokeJoin as resolvedStrokeJoin,
  supportsStrokeAlignment,
} from "../model/stroke";
import { descendantShapeIds, isInstance, isShape, selectionRoots } from "../model/scene";
import { useEditor } from "../store/editorStore";
import ColorField from "./ColorField";
import { getSelectionFrame } from "../canvas/frame";
import { getAssetImage, subscribeImageCache } from "../canvas/imageCache";
import { useEffect, useReducer, useState } from "react";
import type { DocumentAsset, ImageShape } from "../model/types";
import { FONT_OPTIONS } from "./fonts";

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
  const makeClippingMaskSelected = useEditor((s) => s.makeClippingMaskSelected);
  const releaseClippingMaskSelected = useEditor((s) => s.releaseClippingMaskSelected);
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
  const selectedArtboardId = useEditor((s) => s.selectedArtboardId);
  const updateArtboard = useEditor((s) => s.updateArtboard);
  const deleteArtboard = useEditor((s) => s.deleteArtboard);

  const artboard = selectedArtboardId
    ? doc.artboards.find((ab) => ab.id === selectedArtboardId) ?? null
    : null;
  if (artboard) {
    return (
      <ArtboardPanel
        artboard={artboard}
        update={updateArtboard}
        remove={deleteArtboard}
      />
    );
  }

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
    (s) => s.type !== "text" && s.type !== "image" && s.stroke !== null && s.strokeWidth > 0
  );
  const canMakeCompound = canMakeCompoundPathSelection(doc, selection);
  const canReleaseCompound = canReleaseCompoundPathSelection(doc, selection);
  const canMakeClippingMask = canMakeClippingMaskSelection(doc, selection);
  const canReleaseClippingMask = canReleaseClippingMaskSelection(doc, selection);

  // Images carry no paint; hide the fill/stroke controls for image-only picks.
  const paintless = hasSelection && selected.every((s) => s.type === "image");

  // Effects attach to a single node (shape, group, or instance).
  const effectTarget: SceneNode | null =
    selectedInstance ?? selectedGroup ?? (selected.length === 1 ? first : null);

  // Effective values: selected shape's values, else the new-shape defaults.
  const fill = hasSelection ? first.fill : style.fill;
  const stroke = hasSelection ? first.stroke : style.stroke;
  const strokeWidth = hasSelection ? first.strokeWidth : style.strokeWidth;
  const strokeDetails: StrokeDetailsValue = hasSelection
    ? {
        dash: normalizeStrokeDash(first.strokeDash),
        dashOffset: first.strokeDashOffset ?? 0,
        cap: resolvedStrokeCap(first),
        join: resolvedStrokeJoin(first),
        alignment: effectiveStrokeAlignment(first),
      }
    : {
        dash: normalizeStrokeDash(style.strokeDash),
        dashOffset: style.strokeDashOffset,
        cap: style.strokeCap,
        join: style.strokeJoin,
        alignment: style.strokeAlignment,
      };
  const alignmentEnabled = !hasSelection || selected
    .filter((shape) => shape.type !== "image")
    .every(supportsStrokeAlignment);
  const opacity = hasSelection ? first.opacity : 1;

  const setFill = (v: Paint | null) =>
    hasSelection ? updateSelectedStyle({ fill: v }) : setStyle({ fill: v });
  const setStroke = (v: Paint | null) =>
    hasSelection ? updateSelectedStyle({ stroke: v }) : setStyle({ stroke: v });
  const setStrokeWidth = (v: number) =>
    hasSelection
      ? updateSelectedStyle({ strokeWidth: v })
      : setStyle({ strokeWidth: v });
  const setStrokeDetails = (patch: Partial<StrokeDetailsValue>) => {
    if (hasSelection) {
      updateSelectedStyle({
        ...(patch.dash !== undefined
          ? { strokeDash: patch.dash.length ? [...patch.dash] : undefined }
          : {}),
        ...(patch.dashOffset !== undefined
          ? { strokeDashOffset: patch.dashOffset || undefined }
          : {}),
        ...(patch.cap !== undefined ? { strokeCap: patch.cap } : {}),
        ...(patch.join !== undefined ? { strokeJoin: patch.join } : {}),
        ...(patch.alignment !== undefined
          ? { strokeAlignment: patch.alignment }
          : {}),
      });
      return;
    }
    setStyle({
      ...(patch.dash !== undefined ? { strokeDash: [...patch.dash] } : {}),
      ...(patch.dashOffset !== undefined ? { strokeDashOffset: patch.dashOffset } : {}),
      ...(patch.cap !== undefined ? { strokeCap: patch.cap } : {}),
      ...(patch.join !== undefined ? { strokeJoin: patch.join } : {}),
      ...(patch.alignment !== undefined ? { strokeAlignment: patch.alignment } : {}),
    });
  };
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
    const mask = clippingMask(doc, selectedGroup);
    const frame = getSelectionFrame(
      doc,
      mask ? [mask] : selected,
      selectedGroup
    );
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

        {!paintless && (
          <>
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
            <StrokeDetailControls
              value={strokeDetails}
              strokeWidth={strokeWidth}
              alignmentEnabled={alignmentEnabled}
              onChange={setStrokeDetails}
            />
          </>
        )}

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

      {selected.length === 1 && first.type === "image" && (
        <ImageSection shape={first} asset={doc.assets[first.assetId] ?? null} />
      )}

      {selected.length === 1 && first.type === "text" && (
        <TextSection shape={first} />
      )}

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

      {effectTarget && <EffectsSection node={effectTarget} />}

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
          {(canMakeClippingMask || canReleaseClippingMask) && (
            <div className="btn-row">
              {canMakeClippingMask && (
                <button className="ghost-btn" onClick={makeClippingMaskSelected}>
                  Make clipping mask
                </button>
              )}
              {canReleaseClippingMask && (
                <button className="ghost-btn" onClick={releaseClippingMaskSelected}>
                  Release clipping mask
                </button>
              )}
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

interface StrokeDetailsValue {
  dash: number[];
  dashOffset: number;
  cap: StrokeCap;
  join: StrokeJoin;
  alignment: StrokeAlignment;
}

function parseDashPattern(input: string): number[] | null {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const values = trimmed.split(/[\s,]+/).map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  return normalizeStrokeDash(values);
}

function StrokeDetailControls({
  value,
  strokeWidth,
  alignmentEnabled,
  onChange,
}: {
  value: StrokeDetailsValue;
  strokeWidth: number;
  alignmentEnabled: boolean;
  onChange: (patch: Partial<StrokeDetailsValue>) => void;
}) {
  const formatted = value.dash.join(", ");
  const [dashDraft, setDashDraft] = useState(formatted);
  const [dashInvalid, setDashInvalid] = useState(false);

  useEffect(() => {
    setDashDraft(formatted);
    setDashInvalid(false);
  }, [formatted]);

  const commitDash = () => {
    const dash = parseDashPattern(dashDraft);
    if (!dash) {
      setDashInvalid(true);
      return;
    }
    setDashInvalid(false);
    setDashDraft(dash.join(", "));
    onChange({ dash });
  };
  const unit = Math.max(1, strokeWidth);

  return (
    <div className="stroke-details">
      <div className="stroke-detail-grid">
        <label>
          <span>Alignment</span>
          <select
            className="blend-select"
            value={alignmentEnabled ? value.alignment : "center"}
            onChange={(e) => onChange({ alignment: e.target.value as StrokeAlignment })}
          >
            <option value="inside" disabled={!alignmentEnabled}>Inside</option>
            <option value="center">Center</option>
            <option value="outside" disabled={!alignmentEnabled}>Outside</option>
          </select>
        </label>
        <label>
          <span>Cap</span>
          <select
            className="blend-select"
            value={value.cap}
            onChange={(e) => onChange({ cap: e.target.value as StrokeCap })}
          >
            <option value="butt">Butt</option>
            <option value="round">Round</option>
            <option value="square">Square</option>
          </select>
        </label>
        <label>
          <span>Join</span>
          <select
            className="blend-select"
            value={value.join}
            onChange={(e) => onChange({ join: e.target.value as StrokeJoin })}
          >
            <option value="miter">Miter</option>
            <option value="round">Round</option>
            <option value="bevel">Bevel</option>
          </select>
        </label>
        <label>
          <span>Dash offset</span>
          <input
            type="number"
            className="num stroke-offset"
            step={0.5}
            value={value.dashOffset}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) onChange({ dashOffset: next });
            }}
          />
        </label>
      </div>
      <div className="field">
        <label>Dash pattern</label>
        <div className="btn-row stroke-presets">
          <button type="button" className="ghost-btn" onClick={() => onChange({ dash: [] })}>
            Solid
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onChange({ dash: [unit * 4, unit * 2] })}
          >
            Dashed
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onChange({ dash: [0, unit * 2], cap: "round" })}
          >
            Dotted
          </button>
        </div>
        <input
          type="text"
          className={`dash-input${dashInvalid ? " invalid" : ""}`}
          value={dashDraft}
          placeholder="e.g. 8, 4, 2, 4"
          aria-invalid={dashInvalid}
          onChange={(e) => {
            const next = e.target.value;
            setDashDraft(next);
            setDashInvalid(parseDashPattern(next) === null);
          }}
          onBlur={commitDash}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </div>
    </div>
  );
}

/** Preset artboard sizes (label → width×height). */
const ARTBOARD_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "Square", w: 1080, h: 1080 },
  { label: "16:9", w: 1920, h: 1080 },
  { label: "A4", w: 794, h: 1123 },
];

function ArtboardPanel({
  artboard,
  update,
  remove,
}: {
  artboard: Artboard;
  update: (id: string, patch: Partial<Omit<Artboard, "id">>) => void;
  remove: (id: string) => void;
}) {
  const transparent = artboard.background === null;

  const field = (key: "x" | "y" | "width" | "height", label: string) => {
    const v = Math.round(artboard[key]);
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
              update(artboard.id, { [key]: n });
            }
          }}
        />
      </label>
    );
  };

  return (
    <div className="panel">
      <div className="panel-section">
        <div className="panel-title">Artboard</div>
        <div className="field">
          <label>Name</label>
          <div className="field-row">
            <input
              type="text"
              className="artboard-name"
              value={artboard.name}
              onChange={(e) => update(artboard.id, { name: e.target.value })}
            />
          </div>
        </div>
        <div className="geometry-grid">
          {field("x", "X")}
          {field("y", "Y")}
          {field("width", "W")}
          {field("height", "H")}
        </div>
        <div className="btn-row">
          {ARTBOARD_PRESETS.map((p) => (
            <button
              key={p.label}
              className="ghost-btn"
              onClick={() => update(artboard.id, { width: p.w, height: p.h })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Background</div>
        <div className="field">
          <div className="field-row">
            <input
              type="color"
              value={transparent ? "#ffffff" : artboard.background ?? "#ffffff"}
              onChange={(e) => update(artboard.id, { background: e.target.value })}
            />
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) =>
                  update(artboard.id, {
                    background: e.target.checked ? null : "#ffffff",
                  })
                }
              />
              Transparent
            </label>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="btn-row">
          <button className="ghost-btn danger" onClick={() => remove(artboard.id)}>
            Delete artboard
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageSection({
  shape,
  asset,
}: {
  shape: ImageShape;
  asset: DocumentAsset | null;
}) {
  const setImageLockAspect = useEditor((s) => s.setImageLockAspect);
  const setShapeGeometry = useEditor((s) => s.setShapeGeometry);
  // The natural size lives on the decoded pixels; re-render once it arrives.
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribeImageCache(bump), []);

  const img = asset ? getAssetImage(asset) : null;
  const natural =
    img && img.naturalWidth > 0 && img.naturalHeight > 0
      ? { w: img.naturalWidth, h: img.naturalHeight }
      : null;

  return (
    <div className="panel-section">
      <div className="panel-title">Image</div>
      <div className="field">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={!!shape.lockAspect}
            onChange={(e) => setImageLockAspect(shape.id, e.target.checked)}
          />
          Lock aspect ratio
        </label>
      </div>
      <div className="btn-row">
        <button
          className="ghost-btn"
          disabled={!natural}
          title={
            natural
              ? `Restore original pixel size (${natural.w}×${natural.h})`
              : "Decoding image…"
          }
          onClick={() =>
            natural &&
            setShapeGeometry(shape.id, { width: natural.w, height: natural.h })
          }
        >
          Reset to natural size
        </button>
        <button
          className="ghost-btn"
          disabled={!natural}
          title="Fix the height to the image's natural aspect ratio"
          onClick={() =>
            natural &&
            setShapeGeometry(shape.id, {
              height: (shape.width * natural.h) / natural.w,
            })
          }
        >
          Reset aspect ratio
        </button>
      </div>
    </div>
  );
}

function TextSection({ shape }: { shape: TextShape }) {
  const update = useEditor((state) => state.updateTextShape);
  const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  return (
    <div className="panel-section">
      <div className="panel-title">Text</div>
      <div className="field">
        <label>Font</label>
        <select
          className="blend-select"
          value={shape.fontFamily}
          onChange={(event) => update(shape.id, { fontFamily: event.target.value })}
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font.name} value={font.name}>{font.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Size</label>
        <div className="field-row">
          <input
            type="number"
            className="num"
            min={1}
            step={1}
            value={shape.fontSize}
            onChange={(event) => update(shape.id, { fontSize: Math.max(1, Number(event.target.value)) })}
          />
          <select
            className="blend-select"
            value={shape.fontWeight}
            onChange={(event) => update(shape.id, { fontWeight: Number(event.target.value) })}
          >
            {weights.map((weight) => <option key={weight} value={weight}>{weight}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={shape.italic}
            onChange={(event) => update(shape.id, { italic: event.target.checked })}
          />
          Italic
        </label>
      </div>
      <div className="field">
        <label>Line height</label>
        <input
          type="number"
          className="num"
          min={0.5}
          step={0.1}
          value={shape.lineHeight}
          onChange={(event) => update(shape.id, { lineHeight: Math.max(0.5, Number(event.target.value)) })}
        />
      </div>
      <div className="field">
        <label>Align</label>
        <select
          className="blend-select"
          value={shape.align}
          onChange={(event) => update(shape.id, { align: event.target.value as TextShape["align"] })}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
      {shape.textMode === "area" && (
        <div className="field">
          <label>Wrapping width</label>
          <input
            type="number"
            className="num"
            min={1}
            step={1}
            value={Math.round(shape.width)}
            onChange={(event) => update(shape.id, { width: Math.max(1, Number(event.target.value)) })}
          />
        </div>
      )}
    </div>
  );
}

function Geometry({ shape }: { shape: Shape }) {
  const setShapeGeometry = useEditor((s) => s.setShapeGeometry);
  const b = shapeBounds(shape);
  // A locked image keeps its ratio when either dimension is typed in.
  const lockRatio =
    shape.type === "image" && shape.lockAspect && b.height > 0
      ? b.width / b.height
      : null;

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
              const patch: Partial<Record<"x" | "y" | "width" | "height", number>> =
                { [key]: n };
              if (lockRatio && key === "width") patch.height = n / lockRatio;
              else if (lockRatio && key === "height") patch.width = n * lockRatio;
              setShapeGeometry(shape.id, patch);
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
      {shape.type !== "text" && field("width", "W")}
      {shape.type !== "text" && field("height", "H")}
    </div>
  );
}

function effectLabel(type: Effect["type"]): string {
  return type === "blur" ? "Blur" : "Drop Shadow";
}

function EffectsSection({ node }: { node: SceneNode }) {
  const setNodeEffects = useEditor((s) => s.setNodeEffects);
  const effects = node.effects ?? [];

  const replace = (index: number, next: Effect) =>
    setNodeEffects(node.id, effects.map((e, i) => (i === index ? next : e)));
  const remove = (index: number) =>
    setNodeEffects(node.id, effects.filter((_, i) => i !== index));
  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= effects.length) return;
    const next = [...effects];
    [next[index], next[to]] = [next[to], next[index]];
    setNodeEffects(node.id, next);
  };
  const add = (type: Effect["type"]) =>
    setNodeEffects(node.id, [...effects, defaultEffect(type)]);

  const numField = (
    label: string,
    value: number,
    onChange: (n: number) => void,
    opts: { min?: number; step?: number } = {}
  ) => (
    <label className="geo-field">
      <span>{label}</span>
      <input
        type="number"
        className="num"
        min={opts.min}
        step={opts.step ?? 1}
        value={Math.round(value * 100) / 100}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
    </label>
  );

  return (
    <div className="panel-section">
      <div className="panel-title">Effects</div>
      {effects.map((effect, i) => (
        <div className="effect-card" key={i}>
          <div className="field-row effect-head">
            <span className="effect-name">{effectLabel(effect.type)}</span>
            <button className="ghost-btn icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button className="ghost-btn icon-btn" title="Move down" disabled={i === effects.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button className="ghost-btn icon-btn danger" title="Remove" onClick={() => remove(i)}>✕</button>
          </div>
          {effect.type === "blur" ? (
            <div className="geometry-grid">
              {numField("Radius", effect.radius, (n) => replace(i, { ...effect, radius: Math.max(0, n) }), { min: 0 })}
            </div>
          ) : (
            <>
              <div className="geometry-grid">
                {numField("X", effect.offsetX, (n) => replace(i, { ...effect, offsetX: n }))}
                {numField("Y", effect.offsetY, (n) => replace(i, { ...effect, offsetY: n }))}
                {numField("Blur", effect.blur, (n) => replace(i, { ...effect, blur: Math.max(0, n) }), { min: 0 })}
              </div>
              <div className="field-row">
                <input
                  type="color"
                  value={(effect as DropShadowEffect).color}
                  onChange={(e) => replace(i, { ...effect, color: e.target.value })}
                />
                <label className="geo-field">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={effect.alpha}
                    onChange={(e) => replace(i, { ...effect, alpha: Number(e.target.value) })}
                  />
                </label>
                <span className="num readout">{Math.round(effect.alpha * 100)}%</span>
              </div>
            </>
          )}
        </div>
      ))}
      <div className="field">
        <select
          className="blend-select"
          value=""
          onChange={(e) => {
            if (e.target.value) add(e.target.value as Effect["type"]);
          }}
        >
          <option value="">Add effect…</option>
          <option value="drop-shadow">Drop Shadow</option>
          <option value="blur">Blur</option>
        </select>
      </div>
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
    case "image":
      return "Image";
    case "text":
      return "Text";
  }
}
