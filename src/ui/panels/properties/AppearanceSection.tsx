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
  type Document,
  type Shape,
} from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ColorField from "../../ColorField";
import ScrubbableNumber from "../../ScrubbableNumber";
import StrokeDetailControls, {
  type StrokeDetailsValue,
} from "./StrokeDetailControls";
import {
  BlendModeField,
  OpacityField,
  RotationField,
} from "./StyleFields";

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
}: {
  doc: Document;
  selected: Shape[];
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
    const shared = {
      ...(patch.cap !== undefined ? { strokeCap: patch.cap } : {}),
      ...(patch.join !== undefined ? { strokeJoin: patch.join } : {}),
      ...(patch.alignment !== undefined
        ? { strokeAlignment: patch.alignment }
        : {}),
    };
    if (hasSelection) {
      // Shapes keep dash fields sparse: empty dash / zero offset are dropped.
      updateSelectedStyle({
        ...shared,
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
      });
      return;
    }
    setStyle({
      ...shared,
      ...(patch.dash !== undefined
        ? { strokeDash: [...patch.dash] }
        : {}),
      ...(patch.dashOffset !== undefined
        ? { strokeDashOffset: patch.dashOffset }
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

          <div className="field-inline">
            <label>Stroke width</label>
            <ScrubbableNumber
              className="num"
              min={0}
              step={0.5}
              value={strokeWidth}
              onChange={setStrokeWidth}
              aria-label="Stroke width"
            />
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
        <OpacityField
          label="Opacity"
          value={opacity}
          onChange={(value) => updateSelectedStyle({ opacity: value })}
        />
      )}

      {hasSelection && (
        <BlendModeField
          label="Blend mode"
          value={first.blendMode}
          onChange={(value) =>
            updateSelectedStyle({ blendMode: value })
          }
        />
      )}

      {selected.length === 1 && (
        <RotationField
          label="Rotation"
          degrees={rotationDeg}
          onChange={setRotation}
          resetDisabled={first.transformOrigin === null}
          onReset={() =>
            updateSelectedStyle({ transformOrigin: null })
          }
        />
      )}
    </div>
  );
}
