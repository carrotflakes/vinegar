import { useRef } from "react";

type Props = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  "aria-label"?: string;
};

/** Number field that can be scrubbed: drag left/right to change the value, or
 * click to edit it as text. Hold Shift for coarse (×10) or Alt for fine (×0.1)
 * steps. Native ↑/↓ keys still adjust by `step` while focused. */
export default function ScrubbableNumber({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  "aria-label": ariaLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Drag bookkeeping kept in a ref so listeners see the latest without re-render.
  const drag = useRef<{
    startX: number;
    startValue: number;
    scrubbing: boolean;
    pointerId: number;
  } | null>(null);

  const clamp = (v: number) => {
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    return v;
  };

  const commit = (raw: number, effectiveStep: number) => {
    // Round to the effective step so fine/coarse drags land on clean values and
    // floating-point noise (0.30000004) never reaches the store.
    const snapped = Math.round(raw / effectiveStep) * effectiveStep;
    const decimals = (String(effectiveStep).split(".")[1] ?? "").length;
    onChange(clamp(Number(snapped.toFixed(decimals))));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (e.button !== 0) return;
    drag.current = {
      startX: e.clientX,
      startValue: value,
      scrubbing: false,
      pointerId: e.pointerId,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.scrubbing) {
      if (Math.abs(dx) < 3) return; // tolerate jitter so clicks still edit
      d.scrubbing = true;
      inputRef.current?.blur();
      inputRef.current?.setPointerCapture(d.pointerId);
    }
    const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const effectiveStep = step * multiplier;
    // 4px of travel per step keeps the drag controllable.
    const steps = Math.round(dx / 4);
    commit(d.startValue + steps * effectiveStep, effectiveStep);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.scrubbing) {
      inputRef.current?.releasePointerCapture(d.pointerId);
    } else {
      // A plain click: focus for text editing.
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    e.preventDefault();
  };

  return (
    <input
      ref={inputRef}
      type="number"
      className={className}
      style={{ cursor: "ew-resize" }}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(clamp(v));
      }}
    />
  );
}
