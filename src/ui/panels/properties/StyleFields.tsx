import {
  BLEND_MODES,
  type BlendMode,
} from "../../../model/types";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";

function blendLabel(mode: BlendMode): string {
  const words = mode.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function BlendModeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: BlendMode | undefined;
  onChange: (value: BlendMode | undefined) => void;
}) {
  return (
    <div className="field-inline">
      <label>{label}</label>
      <select
        className="blend-select"
        value={value ?? "normal"}
        onChange={(event) => {
          const next = event.target.value as BlendMode;
          onChange(next === "normal" ? undefined : next);
        }}
      >
        {BLEND_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {blendLabel(mode)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Percentage input over a 0..1 opacity value. */
export function OpacityField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field-inline">
      <label>{label}</label>
      <div className="num-suffix">
        <ScrubbableNumber
          className="num"
          min={0}
          max={100}
          step={1}
          value={Math.round(value * 100)}
          onChange={(next) => onChange(next / 100)}
          aria-label={label}
        />
        <span className="unit">%</span>
      </div>
    </div>
  );
}

export function RotationField({
  label,
  degrees,
  onChange,
  resetDisabled,
  onReset,
}: {
  label: string;
  degrees: number;
  onChange: (degrees: number) => void;
  resetDisabled: boolean;
  onReset: () => void;
}) {
  return (
    <div className="field">
      <div className="field-inline">
        <label>{label}</label>
        <ScrubbableNumber
          className="num"
          step={1}
          value={degrees}
          onChange={onChange}
          aria-label={label}
        />
      </div>
      <button
        className="ghost-btn"
        disabled={resetDisabled}
        onClick={onReset}
      >
        Reset rotation center
      </button>
    </div>
  );
}
