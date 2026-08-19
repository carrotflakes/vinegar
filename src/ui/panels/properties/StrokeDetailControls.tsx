import { useEffect, useState } from "react";
import {
  normalizeStrokeDash,
} from "../../../model/stroke";
import type {
  StrokeAlignment,
  StrokeCap,
  StrokeJoin,
} from "../../../model/types";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import { MIXED_OPTION, MixedOption } from "./StyleFields";

export interface StrokeDetailsValue {
  dash: number[];
  dashOffset: number;
  cap: StrokeCap;
  join: StrokeJoin;
  alignment: StrokeAlignment;
}

/** Which of the fields the selected shapes disagree on. */
export type StrokeDetailsMixed = Partial<
  Record<keyof StrokeDetailsValue, boolean>
>;

function parseDashPattern(input: string): number[] | null {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const values = trimmed.split(/[\s,]+/).map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  return normalizeStrokeDash(values);
}

export default function StrokeDetailControls({
  value,
  strokeWidth,
  alignmentEnabled,
  mixed = {},
  onChange,
}: {
  value: StrokeDetailsValue;
  strokeWidth: number;
  alignmentEnabled: boolean;
  mixed?: StrokeDetailsMixed;
  onChange: (patch: Partial<StrokeDetailsValue>) => void;
}) {
  // A mixed dash pattern has no text to show; the field starts empty and any
  // pattern typed into it goes to every selected shape.
  const formatted = mixed.dash ? "" : value.dash.join(", ");
  const [dashDraft, setDashDraft] = useState(formatted);
  const [dashInvalid, setDashInvalid] = useState(false);

  useEffect(() => {
    setDashDraft(formatted);
    setDashInvalid(false);
  }, [formatted]);

  const commitDash = () => {
    // Leaving a mixed field untouched must not flatten every shape to solid.
    if (mixed.dash && dashDraft.trim() === "") return;
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
            value={
              mixed.alignment
                ? MIXED_OPTION
                : alignmentEnabled
                  ? value.alignment
                  : "center"
            }
            onChange={(event) =>
              onChange({
                alignment: event.target.value as StrokeAlignment,
              })
            }
          >
            {mixed.alignment && <MixedOption />}
            <option value="inside" disabled={!alignmentEnabled}>Inside</option>
            <option value="center">Center</option>
            <option value="outside" disabled={!alignmentEnabled}>Outside</option>
          </select>
        </label>
        <label>
          <span>Cap</span>
          <select
            className="blend-select"
            value={mixed.cap ? MIXED_OPTION : value.cap}
            onChange={(event) =>
              onChange({ cap: event.target.value as StrokeCap })
            }
          >
            {mixed.cap && <MixedOption />}
            <option value="butt">Butt</option>
            <option value="round">Round</option>
            <option value="square">Square</option>
          </select>
        </label>
        <label>
          <span>Join</span>
          <select
            className="blend-select"
            value={mixed.join ? MIXED_OPTION : value.join}
            onChange={(event) =>
              onChange({ join: event.target.value as StrokeJoin })
            }
          >
            {mixed.join && <MixedOption />}
            <option value="miter">Miter</option>
            <option value="round">Round</option>
            <option value="bevel">Bevel</option>
          </select>
        </label>
        <label>
          <span>Dash offset</span>
          <ScrubbableNumber
            className="num stroke-offset"
            step={0.5}
            mixed={mixed.dashOffset ?? false}
            value={value.dashOffset}
            defaultValue={0}
            onChange={(next) => onChange({ dashOffset: next })}
            aria-label="Dash offset"
          />
        </label>
      </div>
      <div className="field">
        <label>Dash pattern</label>
        <div className="btn-row stroke-presets">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onChange({ dash: [] })}
          >
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
          placeholder={mixed.dash ? "Mixed" : "e.g. 8, 4, 2, 4"}
          aria-invalid={dashInvalid}
          onChange={(event) => {
            const next = event.target.value;
            setDashDraft(next);
            setDashInvalid(parseDashPattern(next) === null);
          }}
          onBlur={commitDash}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </div>
    </div>
  );
}
