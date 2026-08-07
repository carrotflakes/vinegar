// The gradient section of the colour popover: kind, placement and the stop
// ramp. Geometry edits go through the `model/gradient` helpers, so the panel
// and the on-canvas gradient tool always agree on what an edit means.

import { useRef, useState } from "react";
import {
  addStopAt,
  type GradientKind,
  type GradientPaint,
  type GradientSpread,
  gradientAngle,
  gradientLength,
  removeStop,
  reverseStops,
  sortedStops,
  stopsToCssBar,
  updateStop,
  withGradientAngle,
  withGradientKind,
  withGradientLength,
  withGradientSpace,
} from "@/model/gradient";
import type { Bounds } from "@/model/types";
import type { InterpolationSpace } from "@/model/color";
import ColorInput from "./ColorInput";
import ScrubbableNumber from "./ScrubbableNumber";
import "./GradientEditor.css";

const KINDS: { id: GradientKind; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "radial", label: "Radial" },
  { id: "conic", label: "Conic" },
];

const SPREADS: { id: GradientSpread; label: string; hint: string }[] = [
  { id: "pad", label: "Pad", hint: "Hold the end colours beyond the ramp" },
  { id: "repeat", label: "Repeat", hint: "Restart the ramp beyond its ends" },
  { id: "reflect", label: "Reflect", hint: "Mirror the ramp beyond its ends" },
];

const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

/** Transparency checkerboard painted behind the ramp (sized by the stylesheet). */
const CHECKER =
  "linear-gradient(45deg, #d7dbe2 25%, transparent 25%, transparent 75%, #d7dbe2 75%), " +
  "linear-gradient(45deg, #d7dbe2 25%, transparent 25%, transparent 75%, #d7dbe2 75%)";

interface Props {
  value: GradientPaint;
  onChange: (paint: GradientPaint) => void;
  /** Fill bounds of the shape being edited, for bounds↔local conversions. */
  bounds: Bounds | null;
}

export default function GradientEditor({ value, onChange, bounds }: Props) {
  const stops = sortedStops(value.stops);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = stops.find((s) => s.id === selectedId) ?? stops[0]!;
  const trackRef = useRef<HTMLDivElement>(null);

  /** Pointer x on the track as a 0..1 ramp offset. */
  const offsetAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  // Dragging a stop or a midpoint diamond: both just write one number.
  const dragStop = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setSelectedId(id);
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      onChange(updateStop(value, id, { offset: offsetAt(ev.clientX) }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const dragMidpoint = (e: React.PointerEvent, id: string, from: number, to: number) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const span = to - from;
    const move = (ev: PointerEvent) => {
      if (span <= 1e-6) return;
      onChange(updateStop(value, id, { midpoint: (offsetAt(ev.clientX) - from) / span }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const addAt = (e: React.PointerEvent) => {
    const { paint, stop } = addStopAt(value, offsetAt(e.clientX));
    onChange(paint);
    setSelectedId(stop.id);
  };

  const setKind = (kind: GradientKind) => onChange(withGradientKind(value, kind, bounds));

  return (
    <>
      <div className="paint-type-row">
        {KINDS.map((k) => (
          <button
            key={k.id}
            className={"paint-type-btn" + (value.kind === k.id ? " active" : "")}
            onClick={() => setKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div
        className="gradient-track"
        ref={trackRef}
        style={{ backgroundImage: `${stopsToCssBar(value)}, ${CHECKER}` }}
        onPointerDown={addAt}
        title="Click to add a stop"
      >
        {stops.map((s, i) => {
          const next = stops[i + 1];
          return (
            <span key={s.id}>
              {next && (
                <span
                  className="gradient-midpoint"
                  style={{ left: `${(s.offset + (next.offset - s.offset) * s.midpoint) * 100}%` }}
                  onPointerDown={(e) => dragMidpoint(e, s.id, s.offset, next.offset)}
                  title="Midpoint of this blend"
                />
              )}
              <span
                className={"gradient-handle" + (s.id === selected.id ? " selected" : "")}
                style={{ left: `${s.offset * 100}%`, color: s.color }}
                onPointerDown={(e) => dragStop(e, s.id)}
                title={`${s.color} · ${Math.round(s.offset * 100)}%`}
              />
            </span>
          );
        })}
      </div>

      <div className="gradient-stop">
        <ColorInput
          className="stop-color"
          value={selected.color}
          onChange={(color) => onChange(updateStop(value, selected.id, { color }))}
          alpha={selected.alpha}
          onAlphaChange={(alpha) => onChange(updateStop(value, selected.id, { alpha }))}
          title="Stop color"
        />
        <label className="offset-input">
          Pos
          <ScrubbableNumber
            value={Math.round(selected.offset * 100)}
            onChange={(v) => onChange(updateStop(value, selected.id, { offset: v / 100 }))}
            min={0}
            max={100}
            aria-label="Stop position"
          />
        </label>
        <button
          className="stop-remove"
          title="Remove stop"
          disabled={stops.length <= 2}
          onClick={() => onChange(removeStop(value, selected.id))}
        >
          ×
        </button>
        <button
          className="stop-remove"
          title="Reverse the ramp"
          onClick={() => onChange(reverseStops(value))}
        >
          ⇄
        </button>
      </div>

      <div className="color-pop-alpha">
        <span className="alpha-label">Angle</span>
        <input
          type="range"
          min={-180}
          max={180}
          value={deg(gradientAngle(value))}
          onChange={(e) =>
            onChange(withGradientAngle(value, (Number(e.target.value) * Math.PI) / 180))
          }
        />
        <span className="alpha-value">{deg(gradientAngle(value))}°</span>
      </div>

      <div className="gradient-num-row">
        <span className="alpha-label">{value.kind === "linear" ? "Length" : "Radius"}</span>
        <label className="offset-input">
          {value.space === "bounds" ? "%" : "px"}
          <ScrubbableNumber
            value={
              value.space === "bounds"
                ? Math.round(gradientLength(value) * 100)
                : Math.round(gradientLength(value) * 10) / 10
            }
            onChange={(v) =>
              onChange(withGradientLength(value, value.space === "bounds" ? v / 100 : v))
            }
            min={0}
            aria-label="Gradient length"
          />
        </label>
      </div>

      {value.kind !== "linear" && (
        <div className="color-pop-alpha">
          <span className="alpha-label">Aspect</span>
          <input
            type="range"
            min={10}
            max={400}
            value={Math.round(value.ratio * 100)}
            onChange={(e) => onChange({ ...value, ratio: Number(e.target.value) / 100 })}
          />
          <span className="alpha-value">{Math.round(value.ratio * 100)}%</span>
        </div>
      )}

      {value.kind === "radial" && (
        <div className="gradient-num-row">
          <span className="alpha-label">Focus</span>
          <label className="offset-input">
            X
            <ScrubbableNumber
              value={Math.round(value.focal.x * 100) / 100}
              onChange={(x) => onChange({ ...value, focal: { ...value.focal, x } })}
              aria-label="Focal X"
            />
          </label>
          <label className="offset-input">
            Y
            <ScrubbableNumber
              value={Math.round(value.focal.y * 100) / 100}
              onChange={(y) => onChange({ ...value, focal: { ...value.focal, y } })}
              aria-label="Focal Y"
            />
          </label>
        </div>
      )}

      {value.kind !== "conic" && (
        <>
          <div className="color-pop-label">Beyond the ramp</div>
          <div className="paint-type-row">
            {SPREADS.map((s) => (
              <button
                key={s.id}
                className={"paint-type-btn" + (value.spread === s.id ? " active" : "")}
                title={s.hint}
                onClick={() => onChange({ ...value, spread: s.id })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="color-pop-label">Blending</div>
      <div className="paint-type-row">
        {(["srgb", "oklab"] as InterpolationSpace[]).map((space) => (
          <button
            key={space}
            className={"paint-type-btn" + (value.interpolation === space ? " active" : "")}
            title={
              space === "srgb"
                ? "Plain sRGB blending"
                : "Perceptually even blending — no muddy midtones"
            }
            onClick={() => onChange({ ...value, interpolation: space })}
          >
            {space === "srgb" ? "sRGB" : "OkLab"}
          </button>
        ))}
      </div>

      <div className="color-pop-label">Placement</div>
      <div className="paint-type-row">
        <button
          className={"paint-type-btn" + (value.space === "bounds" ? " active" : "")}
          title="Follow the shape's bounds when it is resized"
          onClick={() => onChange(withGradientSpace(value, "bounds", bounds))}
        >
          Fit shape
        </button>
        <button
          className={"paint-type-btn" + (value.space === "local" ? " active" : "")}
          title="Stay where it is placed, even when the shape is resized"
          onClick={() => onChange(withGradientSpace(value, "local", bounds))}
        >
          Fixed
        </button>
      </div>

      <div className="color-pop-alpha">
        <span className="alpha-label">Alpha</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(value.alpha * 100)}
          onChange={(e) => onChange({ ...value, alpha: Number(e.target.value) / 100 })}
        />
        <span className="alpha-value">{Math.round(value.alpha * 100)}%</span>
      </div>
    </>
  );
}
