import { defaultMarker, isMarkerStroked } from "@/model/marker";
import { MARKER_SHAPES, type Marker, type MarkerShape } from "@/model/types";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";

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
  onChange,
}: {
  end: MarkerEnd;
  value: Marker | null;
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
        value={value?.shape ?? "none"}
        onChange={(event) =>
          onChange(
            event.target.value === "none"
              ? null
              : { ...(value ?? defaultMarker("arrow")), shape: event.target.value as MarkerShape }
          )
        }
      >
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
        value={value?.scale ?? 1}
        defaultValue={1}
        disabled={!value}
        onChange={(scale) => value && onChange({ ...value, scale })}
        aria-label={`${label} marker size`}
      />
      <button
        type="button"
        className={"ghost-btn marker-toggle" + (value && !isMarkerStroked(value) ? " active" : "")}
        aria-pressed={!!value && !isMarkerStroked(value)}
        disabled={!fillable}
        title="Solid or hollow"
        onClick={() => value && onChange({ ...value, filled: !value.filled })}
      >
        Solid
      </button>
      <button
        type="button"
        className={"ghost-btn marker-toggle" + (value?.flip ? " active" : "")}
        aria-pressed={!!value?.flip}
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
  onChange,
}: {
  start: Marker | null;
  end: Marker | null;
  onChange: (patch: { start?: Marker | null; end?: Marker | null }) => void;
}) {
  return (
    <div className="field">
      <label>Markers</label>
      <div className="marker-rows">
        <MarkerRow
          end="start"
          value={start}
          onChange={(marker) => onChange({ start: marker })}
        />
        <MarkerRow
          end="end"
          value={end}
          onChange={(marker) => onChange({ end: marker })}
        />
      </div>
    </div>
  );
}
