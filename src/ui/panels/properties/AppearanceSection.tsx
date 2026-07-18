import { shapeBounds } from "../../../model/bounds";
import {
  applyMatrix,
  applyWorldTransformToNode,
  matrixAngle,
  rotationAbout,
  shapeWorldMatrix,
} from "../../../model/matrix";
import type { Paint } from "../../../model/paint";
import {
  effectiveStrokeAlignment,
  normalizeStrokeDash,
  strokeCap as resolvedStrokeCap,
  strokeJoin as resolvedStrokeJoin,
  supportsStrokeAlignment,
} from "../../../model/stroke";
import {
  BLEND_MODES,
  type BlendMode,
  type Document,
  type Group,
  type Shape,
} from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ColorField from "../../ColorField";
import ScrubbableNumber from "../../ScrubbableNumber";
import StrokeDetailControls, {
  type StrokeDetailsValue,
} from "./StrokeDetailControls";

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
    case "brush":
      return "Brush";
  }
}

export default function AppearanceSection({
  doc,
  selected,
  selectedGroup,
}: {
  doc: Document;
  selected: Shape[];
  selectedGroup: Group | null;
}) {
  const style = useEditor((state) => state.style);
  const updateSelectedStyle = useEditor(
    (state) => state.updateSelectedStyle
  );
  const setStyle = useEditor((state) => state.setStyle);
  const hasSelection = selected.length > 0;
  const first = selected[0];
  const paintless =
    hasSelection && selected.every((shape) => shape.type === "image");

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
  const alignmentEnabled =
    !hasSelection ||
    selected
      .filter((shape) => shape.type !== "image")
      .every(supportsStrokeAlignment);
  const opacity = hasSelection ? first.opacity : 1;

  const setFill = (value: Paint | null) =>
    hasSelection
      ? updateSelectedStyle({ fill: value })
      : setStyle({ fill: value });
  const setStroke = (value: Paint | null) =>
    hasSelection
      ? updateSelectedStyle({ stroke: value })
      : setStyle({ stroke: value });
  const setStrokeWidth = (value: number) =>
    hasSelection
      ? updateSelectedStyle({ strokeWidth: value })
      : setStyle({ strokeWidth: value });
  const setStrokeDetails = (patch: Partial<StrokeDetailsValue>) => {
    if (hasSelection) {
      updateSelectedStyle({
        ...(patch.dash !== undefined
          ? {
              strokeDash: patch.dash.length
                ? [...patch.dash]
                : undefined,
            }
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
      ...(patch.dash !== undefined
        ? { strokeDash: [...patch.dash] }
        : {}),
      ...(patch.dashOffset !== undefined
        ? { strokeDashOffset: patch.dashOffset }
        : {}),
      ...(patch.cap !== undefined ? { strokeCap: patch.cap } : {}),
      ...(patch.join !== undefined ? { strokeJoin: patch.join } : {}),
      ...(patch.alignment !== undefined
        ? { strokeAlignment: patch.alignment }
        : {}),
    });
  };

  const rotationDeg = hasSelection
    ? Math.round(
        (matrixAngle(shapeWorldMatrix(doc, first)) * 180) / Math.PI
      )
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

  return (
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
                onChange={(event) =>
                  setStrokeWidth(Number(event.target.value))
                }
              />
              <ScrubbableNumber
                className="num"
                min={0}
                step={0.5}
                value={strokeWidth}
                onChange={setStrokeWidth}
                aria-label="Stroke width"
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
              onChange={(event) =>
                updateSelectedStyle({
                  opacity: Number(event.target.value),
                })
              }
            />
            <span className="num readout">
              {Math.round(opacity * 100)}%
            </span>
          </div>
        </div>
      )}

      {hasSelection && (
        <div className="field">
          <label>Blend mode</label>
          <select
            className="blend-select"
            value={first.blendMode ?? "normal"}
            onChange={(event) => {
              const value = event.target.value as BlendMode;
              updateSelectedStyle({
                blendMode: value === "normal" ? undefined : value,
              });
            }}
          >
            {BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {blendLabel(mode)}
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
              onChange={(event) =>
                setRotation(Number(event.target.value))
              }
            />
            <ScrubbableNumber
              className="num"
              step={1}
              value={rotationDeg}
              onChange={setRotation}
              aria-label="Rotation"
            />
          </div>
          <button
            className="ghost-btn"
            disabled={first.transformOrigin === null}
            onClick={() =>
              updateSelectedStyle({ transformOrigin: null })
            }
          >
            Reset rotation center
          </button>
        </div>
      )}
    </div>
  );
}
