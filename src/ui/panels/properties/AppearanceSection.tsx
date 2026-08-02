import type { Paint } from "../../../model/paint";
import {
  effectiveStrokeAlignment,
  normalizeStrokeDash,
  supportsStrokeAlignment,
} from "../../../model/stroke";
import { type PathShape, type Shape } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import { STROKE_WIDTH_PATH } from "@/model/params";
import BindableNumber from "@/ui/controls/BindableNumber";
import ColorField from "@/ui/controls/ColorField";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import SegmentedControl, {
  type SegmentedControlOption,
} from "@/ui/controls/SegmentedControl";
import StrokeDetailControls, {
  type StrokeDetailsValue,
} from "./StrokeDetailControls";
import {
  BlendModeField,
  OpacityField,
} from "./StyleFields";
import Section from "../Section";
import { resolvedSubpaths } from "@/model/path/pathModifiers";

const FILL_RULES: SegmentedControlOption<PathShape["fillRule"]>[] = [
  { value: "nonzero", label: "Nonzero", title: "Overlaps of same-direction contours stay filled" },
  { value: "evenodd", label: "Even-odd", title: "Every overlap alternates between filled and hollow" },
];

export default function AppearanceSection({
  selected,
}: {
  selected: Shape[];
}) {
  const style = useEditor((state) => state.style);
  const updateSelectedStyle = useEditor(
    (state) => state.updateSelectedStyle
  );
  const setStyle = useEditor((state) => state.setStyle);
  const setSelectedFillRule = useEditor(
    (state) => state.setSelectedFillRule
  );
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
        cap: first.strokeCap,
        join: first.strokeJoin,
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
  // The rule only changes anything once a path has several subpaths, so it stays
  // hidden until one does rather than sitting unused above the stroke controls.
  const paths = selected.filter(
    (shape): shape is PathShape => shape.type === "path"
  );
  const showFillRule =
    paths.length === selected.length &&
    paths.some((path) => resolvedSubpaths(path).length > 1);
  const fillRule = paths.every((path) => path.fillRule === paths[0]?.fillRule)
    ? paths[0]?.fillRule ?? null
    : null;

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
      updateSelectedStyle({
        ...shared,
        ...(patch.dash !== undefined ? { strokeDash: [...patch.dash] } : {}),
        ...(patch.dashOffset !== undefined
          ? { strokeDashOffset: patch.dashOffset }
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

  return (
    <Section
      title={hasSelection ? "Appearance" : "New shape defaults"}
    >
      {!paintless && (
        <>
          <ColorField label="Fill" value={fill} onChange={setFill} />
          <ColorField label="Stroke" value={stroke} onChange={setStroke} />

          <div className="field-inline">
            <label>Stroke width</label>
            {/* Binding is per node, so the link affordance only appears when the
                field addresses exactly one — a multi-selection edits them all
                at once and has no single field to bind. */}
            {selected.length === 1 ? (
              <BindableNumber
                nodeId={first.id}
                path={STROKE_WIDTH_PATH}
                label="Stroke width"
                min={0}
                step={0.5}
                value={strokeWidth}
                onChange={setStrokeWidth}
              />
            ) : (
              <ScrubbableNumber
                className="num"
                min={0}
                step={0.5}
                value={strokeWidth}
                onChange={setStrokeWidth}
                aria-label="Stroke width"
              />
            )}
          </div>
          <StrokeDetailControls
            value={strokeDetails}
            strokeWidth={strokeWidth}
            alignmentEnabled={alignmentEnabled}
            onChange={setStrokeDetails}
          />

          {showFillRule && (
            <div className="field">
              <label>Fill rule</label>
              <SegmentedControl
                value={fillRule}
                options={FILL_RULES}
                onChange={setSelectedFillRule}
                ariaLabel="Fill rule"
              />
            </div>
          )}
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
    </Section>
  );
}
