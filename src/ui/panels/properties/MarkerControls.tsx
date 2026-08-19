import { defaultMarker, isMarkerStroked } from "@/model/marker";
import { MARKER_SHAPES, type Marker, type MarkerShape } from "@/model/types";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import { MIXED_OPTION, MixedOption } from "./StyleFields";

const SHAPE_LABELS: Record<MarkerShape, string> = {
  arrow: "Arrow",
  triangle: "Triangle",
  circle: "Circle",
  square: "Square",
  diamond: "Diamond",
  bar: "Bar",
};

/** The two ends a marker can sit on, in the order the path runs. */
export type MarkerEnd = "start" | "end";

const END_LABELS: Record<MarkerEnd, string> = {
  start: "Start",
  end: "End",
};

function MarkerRow({
  end,
  value,
  mixed = false,
  onChange,
}: {
  end: MarkerEnd;
  value: Marker | null;
  /** The selected shapes carry different markers on this end. */
  mixed?: boolean;
  onChange: (marker: Marker | null) => void;
}) {
  const label = END_LABELS[end];
  // `arrow` and `bar` are open contours with nothing to fill, so the solid /
  // hollow choice does not apply to them.
  const fillable = !!value && !["arrow", "bar"].includes(value.shape);
  return (
    <div className="marker-row">
      <label className="marker-end-label" htmlFor={`marker-${end}`}>
        {label}
      </label>
      <select
        id={`marker-${end}`}
        className="blend-select marker-shape-select"
        value={mixed ? MIXED_OPTION : value?.shape ?? "none"}
        onChange={(event) =>
          onChange(
            event.target.value === "none"
              ? null
              : { ...(value ?? defaultMarker("arrow")), shape: event.target.value as MarkerShape }
          )
        }
      >
        {mixed && <MixedOption />}
        <option value="none">None</option>
        {MARKER_SHAPES.map((shape) => (
          <option key={shape} value={shape}>
            {SHAPE_LABELS[shape]}
          </option>
        ))}
      </select>
      <ScrubbableNumber
        className="num marker-scale"
        min={0.1}
        step={0.1}
        mixed={mixed}
        value={value?.scale ?? 1}
        defaultValue={1}
        disabled={!value}
        onChange={(scale) => value && onChange({ ...value, scale })}
        aria-label={`${label} marker size`}
      />
      {/* While the ends disagree the toggles show unset — there is no shared
          state to reflect — but stay live: pressing one commits the first
          marker's setting to every selected end, as every mixed field does. */}
      <button
        type="button"
        className={
          "ghost-btn marker-toggle" +
          (!mixed && value && !isMarkerStroked(value) ? " active" : "")
        }
        aria-pressed={!mixed && !!value && !isMarkerStroked(value)}
        disabled={!fillable}
        title="Solid or hollow"
        onClick={() => value && onChange({ ...value, filled: !value.filled })}
      >
        Solid
      </button>
      <button
        type="button"
        className={
          "ghost-btn marker-toggle" + (!mixed && value?.flip ? " active" : "")
        }
        aria-pressed={!mixed && !!value?.flip}
        disabled={!value}
        title="Point the marker back along the path"
        onClick={() => value && onChange({ ...value, flip: !value.flip })}
      >
        Flip
      </button>
    </div>
  );
}

/**
 * End markers for the selected lines and paths. Markers are painted with the
 * shape's stroke paint at its stroke width, so `size` is a multiple of that
 * width rather than an absolute length. See docs/design/markers.md.
 */
export default function MarkerControls({
  start,
  end,
  mixedStart = false,
  mixedEnd = false,
  onChange,
}: {
  start: Marker | null;
  end: Marker | null;
  mixedStart?: boolean;
  mixedEnd?: boolean;
  onChange: (patch: { start?: Marker | null; end?: Marker | null }) => void;
}) {
  return (
    <div className="field">
      <label>Markers</label>
      <div className="marker-rows">
        <MarkerRow
          end="start"
          value={start}
          mixed={mixedStart}
          onChange={(marker) => onChange({ start: marker })}
        />
        <MarkerRow
          end="end"
          value={end}
          mixed={mixedEnd}
          onChange={(marker) => onChange({ end: marker })}
        />
      </div>
    </div>
  );
}
