import { LuLocateFixed } from "react-icons/lu";
import {
  BLEND_MODES,
  type BlendMode,
} from "../../../model/types";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";

function blendLabel(mode: BlendMode): string {
  const words = mode.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Value a `<select>` shows when the selected nodes disagree. See `MixedOption`. */
export const MIXED_OPTION = "__mixed__";

/**
 * The placeholder entry a mixed `<select>` sits on. Disabled, so picking it is
 * impossible — choosing any real option is what commits a value to every node.
 */
export function MixedOption() {
  return (
    <option value={MIXED_OPTION} disabled>
      Mixed
    </option>
  );
}

export function BlendModeField({
  label,
  value,
  mixed = false,
  onChange,
}: {
  label: string;
  value: BlendMode;
  mixed?: boolean;
  onChange: (value: BlendMode) => void;
}) {
  return (
    <div className="field-inline">
      <label>{label}</label>
      <select
        className="blend-select"
        value={mixed ? MIXED_OPTION : value}
        onChange={(event) => onChange(event.target.value as BlendMode)}
      >
        {mixed && <MixedOption />}
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
  mixed = false,
  onChange,
}: {
  label: string;
  value: number;
  mixed?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field-inline">
      <label>{label}</label>
      <ScrubbableNumber
        className="num"
        min={0}
        max={100}
        step={1}
        unit="%"
        mixed={mixed}
        value={Math.round(value * 100)}
        defaultValue={100}
        onChange={(next) => onChange(next / 100)}
        aria-label={label}
      />
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
    <div className="field-inline">
      <label>{label}</label>
      <div className="field-row">
        <ScrubbableNumber
          className="num"
          step={1}
          unit="°"
          value={degrees}
          defaultValue={0}
          onChange={onChange}
          aria-label={label}
        />
        {/* Resetting the pivot belongs to rotation but is rare: an icon on the
            same row rather than a full-width button under it. */}
        <ResetPivotButton disabled={resetDisabled} onReset={onReset} />
      </div>
    </div>
  );
}

/** Shared by the single-node and multi-node transform sections. */
export function ResetPivotButton({
  disabled,
  onReset,
}: {
  disabled: boolean;
  onReset: () => void;
}) {
  return (
    <button
      className="icon-btn"
      title="Reset rotation center"
      aria-label="Reset rotation center"
      disabled={disabled}
      onClick={onReset}
    >
      <LuLocateFixed aria-hidden />
    </button>
  );
}
