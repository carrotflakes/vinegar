import { LuPipette } from "react-icons/lu";
import type { Paint } from "../../../model/paint";
import {
  effectiveStrokeAlignment,
  normalizeStrokeDash,
  supportsStrokeAlignment,
} from "../../../model/stroke";
import { type Marker, type PathShape, type Shape } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import { STROKE_WIDTH_PATH } from "@/model/params";
import BindableNumber from "@/ui/controls/BindableNumber";
import ColorField from "@/ui/controls/ColorField";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import SegmentedControl, {
  type SegmentedControlOption,
} from "@/ui/controls/SegmentedControl";
import MarkerControls from "./MarkerControls";
import StrokeDetailControls, {
  type StrokeDetailsMixed,
  type StrokeDetailsValue,
} from "./StrokeDetailControls";
import {
  BlendModeField,
  OpacityField,
} from "./StyleFields";
import Section from "../Section";
import { isMarkable } from "@/model/marker";
import { resolvedSubpaths } from "@/model/path/pathModifiers";
import { shapeBounds } from "@/model/geometry/bounds";
import { sharedValue } from "./sharedValue";

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
  const setSelectedMarkers = useEditor((state) => state.setSelectedMarkers);
  const setStyleFromSelection = useEditor(
    (state) => state.setStyleFromSelection
  );
  const hasSelection = selected.length > 0;
  const first = selected[0];
  const paintless =
    hasSelection && selected.every((shape) => shape.type === "image");

  const paintBounds = selected.length === 1 && first ? shapeBounds(first) : null;
  const paintMemoryKey = hasSelection
    ? selected.map((shape) => shape.id).join("|")
    : "defaults";
  // Every field addresses the whole selection, so it may only claim a value the
  // whole selection agrees on — otherwise it reports "Mixed" (`sharedValue`).
  // With nothing selected the fields stand for the new-shape defaults, which
  // are a single value and never mixed.
  const shared = <R,>(read: (shape: Shape) => R, fallback: R) =>
    sharedValue(selected, read, fallback);
  const fill = shared((shape) => shape.fill, style.fill);
  const stroke = shared((shape) => shape.stroke, style.stroke);
  const strokeWidth = shared(
    (shape) => shape.strokeWidth,
    style.strokeWidth
  );
  const dash = shared(
    (shape) => normalizeStrokeDash(shape.strokeDash),
    normalizeStrokeDash(style.strokeDash)
  );
  const dashOffset = shared(
    (shape) => shape.strokeDashOffset ?? 0,
    style.strokeDashOffset
  );
  const cap = shared((shape) => shape.strokeCap, style.strokeCap);
  const join = shared((shape) => shape.strokeJoin, style.strokeJoin);
  const alignment = shared(
    effectiveStrokeAlignment,
    style.strokeAlignment
  );
  const strokeDetails: StrokeDetailsValue = {
    dash: dash.value,
    dashOffset: dashOffset.value,
    cap: cap.value,
    join: join.value,
    alignment: alignment.value,
  };
  const strokeDetailsMixed: StrokeDetailsMixed = {
    dash: dash.mixed,
    dashOffset: dashOffset.mixed,
    cap: cap.mixed,
    join: join.mixed,
    alignment: alignment.mixed,
  };
  // A shape with no stroke has nothing to align, cap, join or dash, so the six
  // rows of stroke detail stay folded away until there is a stroke to detail.
  // Two exceptions, both about a hidden row being the only way to reach state
  // that still exists: a bound stroke width can only be unbound from its own
  // field, and the new-shape defaults (no selection) keep a width, dash and cap
  // that outlive the paint being set to none — and that panel is a lone section
  // with room to spare.
  const strokeWidthBound = selected.some(
    (shape) => shape.bindings[STROKE_WIDTH_PATH] != null
  );
  const hasStroke =
    !hasSelection || stroke.value !== null || stroke.mixed || strokeWidthBound;
  const alignmentEnabled =
    !hasSelection ||
    selected
      .filter((shape) => shape.type !== "image")
      .every(supportsStrokeAlignment);
  const opacity = shared((shape) => shape.opacity, 1);
  const blendMode = shared((shape) => shape.blendMode, "normal" as const);
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
  // Only open geometry has ends to mark, so the controls appear exactly when
  // every selected shape can carry a marker — or when there is no selection at
  // all and the fields stand for what the next line or path will be drawn with.
  const markerSource =
    hasSelection && first && isMarkable(first) && selected.every(isMarkable)
      ? first
      : null;
  const markable = markerSource ? selected.filter(isMarkable) : [];
  const markerStart = sharedValue(
    markable,
    (shape) => shape.markerStart ?? null,
    style.markerStart
  );
  const markerEnd = sharedValue(
    markable,
    (shape) => shape.markerEnd ?? null,
    style.markerEnd
  );
  const markers = hasSelection
    ? markerSource && { start: markerStart, end: markerEnd }
    : {
        start: { value: style.markerStart, mixed: false },
        end: { value: style.markerEnd, mixed: false },
      };
  const setMarkers = (patch: { start?: Marker | null; end?: Marker | null }) => {
    if (hasSelection) {
      setSelectedMarkers(patch);
      return;
    }
    setStyle({
      ...(patch.start !== undefined ? { markerStart: patch.start } : {}),
      ...(patch.end !== undefined ? { markerEnd: patch.end } : {}),
    });
  };
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
      id="properties.appearance"
      title={hasSelection ? "Appearance" : "New shape defaults"}
      // The defaults are reachable only with an empty selection, so the button
      // that copies this shape's paint into them lives on this same header.
      actions={
        first && first.type !== "image" ? (
          <button
            className="layer-icon-btn title-add"
            title="Use as new shape defaults"
            onClick={setStyleFromSelection}
          >
            <LuPipette />
          </button>
        ) : null
      }
    >
      {!paintless && (
        <>
          {/* Gradients are placed over the shape's own box, so the field needs
              it; a defaults field (no selection) has none. */}
          <ColorField
            label="Fill"
            value={fill.value}
            mixed={fill.mixed}
            onChange={setFill}
            bounds={paintBounds}
            memoryKey={paintMemoryKey}
          />
          <ColorField
            label="Stroke"
            value={stroke.value}
            mixed={stroke.mixed}
            onChange={setStroke}
            bounds={paintBounds}
            memoryKey={paintMemoryKey}
          />

          {hasStroke && (
            <>
              <div className="field-inline">
                <label>Stroke width</label>
                {/* Binding is per node, so the link affordance only appears when
                    the field addresses exactly one — a multi-selection edits
                    them all at once and has no single field to bind. */}
                {selected.length === 1 && first ? (
                  <BindableNumber
                    nodeId={first.id}
                    path={STROKE_WIDTH_PATH}
                    label="Stroke width"
                    min={0}
                    step={0.5}
                    value={strokeWidth.value}
                    onChange={setStrokeWidth}
                  />
                ) : (
                  <ScrubbableNumber
                    className="num"
                    min={0}
                    step={0.5}
                    mixed={strokeWidth.mixed}
                    value={strokeWidth.value}
                    onChange={setStrokeWidth}
                    aria-label="Stroke width"
                  />
                )}
              </div>
              <StrokeDetailControls
                value={strokeDetails}
                mixed={strokeDetailsMixed}
                strokeWidth={strokeWidth.value}
                alignmentEnabled={alignmentEnabled}
                onChange={setStrokeDetails}
              />

              {markers && (
                <MarkerControls
                  start={markers.start.value}
                  end={markers.end.value}
                  mixedStart={markers.start.mixed}
                  mixedEnd={markers.end.mixed}
                  onChange={setMarkers}
                />
              )}
            </>
          )}

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
          value={opacity.value}
          mixed={opacity.mixed}
          onChange={(value) => updateSelectedStyle({ opacity: value })}
        />
      )}

      {hasSelection && (
        <BlendModeField
          label="Blend mode"
          value={blendMode.value}
          mixed={blendMode.mixed}
          onChange={(value) =>
            updateSelectedStyle({ blendMode: value })
          }
        />
      )}
    </Section>
  );
}
