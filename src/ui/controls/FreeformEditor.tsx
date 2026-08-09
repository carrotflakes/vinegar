// The freeform-gradient section of the colour popover: a placement pad the
// colour points are dragged on, plus the field's settings. Every edit goes
// through the `model/freeform` helpers, so the panel and the on-canvas
// gradient tool always agree on what an edit means.
//
// The pad draws the *real* field (`freeformRaster` into a small canvas) rather
// than the CSS approximation used for swatch previews — this is where the user
// judges the result, so it has to be the truth.

import { useEffect, useRef, useState } from "react";
import {
  addFreeformPointAt,
  type FreeformMethod,
  type FreeformPaint,
  clampFalloff,
  freeformRaster,
  fromFreeformSpace,
  MAX_EXPONENT,
  removeFreeformPoint,
  toFreeformSpace,
  updateFreeformPoint,
  withFreeformMethod,
  withFreeformSpace,
} from "@/model/freeform";
import type { Bounds, Vec2 } from "@/model/types";
import type { InterpolationSpace } from "@/model/color";
import ColorInput from "./ColorInput";
import ScrubbableNumber from "./ScrubbableNumber";
import "./FreeformEditor.css";

const METHODS: { id: FreeformMethod; label: string; hint: string }[] = [
  {
    id: "shepard",
    label: "Shepard",
    hint: "Inverse distance weighting — each point keeps its exact color",
  },
  {
    id: "gaussian",
    label: "Gaussian",
    hint: "Radial basis — a smoother, hazier blend",
  },
];

/** Pad raster size; the field is smooth, so a small one upscales cleanly. */
const PAD_W = 180;
const PAD_H = 120;

/** A stand-in box for a paint being edited without a shape (new-shape defaults). */
const FALLBACK_BOUNDS: Bounds = { x: 0, y: 0, width: 100, height: 100 };

interface Props {
  value: FreeformPaint;
  onChange: (paint: FreeformPaint) => void;
  /** Fill bounds of the shape being edited, for bounds↔local conversions. */
  bounds: Bounds | null;
}

export default function FreeformEditor({ value, onChange, bounds }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    value.points.find((p) => p.id === selectedId) ?? value.points[0]!;
  const padRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const box = bounds && bounds.width > 0 && bounds.height > 0 ? bounds : FALLBACK_BOUNDS;

  // The pad shows the shape's box exactly, so a point's unit position in the
  // pad is its local position normalised — via the model's space helpers, so a
  // pinned paint lands in the right place too.
  const unitOf = (position: Vec2): Vec2 => {
    const local = fromFreeformSpace(value, position, box);
    return { x: (local.x - box.x) / box.width, y: (local.y - box.y) / box.height };
  };
  const positionOf = (unit: Vec2): Vec2 =>
    toFreeformSpace(
      value,
      { x: box.x + unit.x * box.width, y: box.y + unit.y * box.height },
      box
    );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || value.points.length === 0) return;
    canvas.width = PAD_W;
    canvas.height = PAD_H;
    ctx.putImageData(
      new ImageData(freeformRaster(value, box, box, PAD_W, PAD_H), PAD_W, PAD_H),
      0,
      0
    );
  }, [value, box.x, box.y, box.width, box.height]);

  /** Pointer position on the pad as 0..1 of the box. */
  const unitAt = (clientX: number, clientY: number): Vec2 => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const dragPoint = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setSelectedId(id);
    e.currentTarget.setPointerCapture(e.pointerId);
    // Read the paint from the closure on every move: `value` is replaced on
    // each edit, but the position being written is derived from the pointer,
    // not from the previous position, so a stale copy cannot drift.
    const move = (ev: PointerEvent) =>
      onChange(
        updateFreeformPoint(value, id, {
          position: positionOf(unitAt(ev.clientX, ev.clientY)),
        })
      );
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const addAt = (e: React.PointerEvent) => {
    const { paint, point } = addFreeformPointAt(
      value,
      positionOf(unitAt(e.clientX, e.clientY))
    );
    onChange(paint);
    setSelectedId(point.id);
  };

  const patch = (p: Parameters<typeof updateFreeformPoint>[2]) =>
    onChange(updateFreeformPoint(value, selected.id, p));

  const selectedUnit = unitOf(selected.position);

  return (
    <>
      <div className="paint-type-row">
        {METHODS.map((m) => (
          <button
            key={m.id}
            className={"paint-type-btn" + (value.method === m.id ? " active" : "")}
            title={m.hint}
            onClick={() => onChange(withFreeformMethod(value, m.id, bounds))}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div
        className="freeform-pad"
        ref={padRef}
        onPointerDown={addAt}
        title="Click to add a color point"
      >
        <canvas ref={canvasRef} />
        {value.points.map((p) => {
          const u = unitOf(p.position);
          return (
            <span
              key={p.id}
              className={"freeform-point" + (p.id === selected.id ? " selected" : "")}
              style={{
                left: `${u.x * 100}%`,
                top: `${u.y * 100}%`,
                color: p.color,
              }}
              onPointerDown={(e) => dragPoint(e, p.id)}
              title={`${p.color} · drag to move`}
            />
          );
        })}
      </div>

      <div className="freeform-point-row">
        <ColorInput
          className="stop-color"
          value={selected.color}
          onChange={(color) => patch({ color })}
          alpha={selected.alpha}
          onAlphaChange={(alpha) => patch({ alpha })}
          title="Point color"
        />
        <label className="offset-input">
          X
          <ScrubbableNumber
            value={Math.round(selectedUnit.x * 100)}
            onChange={(x) => patch({ position: positionOf({ ...selectedUnit, x: x / 100 }) })}
            aria-label="Point X"
          />
        </label>
        <label className="offset-input">
          Y
          <ScrubbableNumber
            value={Math.round(selectedUnit.y * 100)}
            onChange={(y) => patch({ position: positionOf({ ...selectedUnit, y: y / 100 }) })}
            aria-label="Point Y"
          />
        </label>
        <button
          className="stop-remove"
          title="Remove point"
          disabled={value.points.length <= 1}
          onClick={() => onChange(removeFreeformPoint(value, selected.id))}
        >
          ×
        </button>
      </div>

      <div className="color-pop-alpha">
        <span className="alpha-label">Spread</span>
        <input
          type="range"
          min={10}
          max={400}
          value={Math.round(selected.weight * 100)}
          onChange={(e) => patch({ weight: Number(e.target.value) / 100 })}
          title="How far this point's colour reaches, against the others"
        />
        <span className="alpha-value">{Math.round(selected.weight * 100)}%</span>
      </div>

      {value.method === "shepard" ? (
        <div className="color-pop-alpha">
          <span className="alpha-label">Falloff</span>
          <input
            type="range"
            min={100}
            max={MAX_EXPONENT * 100}
            value={Math.round(value.falloff * 100)}
            onChange={(e) => onChange({ ...value, falloff: Number(e.target.value) / 100 })}
            title="Low blends broadly; high pulls the colours into cells"
          />
          <span className="alpha-value">{value.falloff.toFixed(1)}</span>
        </div>
      ) : (
        <div className="gradient-num-row">
          <span className="alpha-label">Radius</span>
          <label className="offset-input">
            {value.space === "bounds" ? "%" : "px"}
            <ScrubbableNumber
              value={
                value.space === "bounds"
                  ? Math.round(value.falloff * 100)
                  : Math.round(value.falloff * 10) / 10
              }
              onChange={(v) =>
                onChange({
                  ...value,
                  falloff: clampFalloff(
                    value.method,
                    value.space === "bounds" ? v / 100 : v
                  ),
                })
              }
              min={1}
              aria-label="Blend radius"
            />
          </label>
        </div>
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
          onClick={() => onChange(withFreeformSpace(value, "bounds", bounds))}
        >
          Fit shape
        </button>
        <button
          className={"paint-type-btn" + (value.space === "local" ? " active" : "")}
          title="Stay where it is placed, even when the shape is resized"
          onClick={() => onChange(withFreeformSpace(value, "local", bounds))}
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
