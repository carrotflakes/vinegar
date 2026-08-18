import { useRef, useState } from "react";
import { usePreferences } from "@/store/preferencesStore";
import { useCoarsePointer } from "@/ui/useCoarsePointer";
import NumberPad from "./NumberPad";
import { isScrub, scrubbedValue, type ScrubScale } from "./scrub";
import "./ScrubbableNumber.css";

type Props = {
  value: number;
  onChange: (value: number) => void;
  min?: number | undefined;
  max?: number;
  step?: number;
  /** `log` scrubs by ratio instead of by `step` — see `ScrubScale`. */
  scale?: ScrubScale;
  /** When set, double-clicking the field resets it to this value. */
  defaultValue?: number;
  /** Unit shown inside the right edge of the field ("%", "px", "°"). Display
   * only — the value the caller gets is always the bare number. */
  unit?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  /** Optional lifecycle hooks for callers that batch a scrub into one undo step. */
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  onScrubCancel?: () => void;
};

/** Number field that can be scrubbed: drag left/right to change the value, or
 * click to edit it as text. Hold Shift for a coarse or Alt for a fine drag.
 * `scale="log"` scrubs by ratio rather than by step. Native ↑/↓ keys still
 * adjust by `step` while focused. Double-click resets to `defaultValue` when
 * one is provided. `unit` prints a unit inside the field without touching the
 * value. */
export default function ScrubbableNumber({
  value,
  onChange,
  min,
  max,
  step = 1,
  scale = "linear",
  defaultValue,
  unit,
  className,
  disabled,
  onScrubStart,
  onScrubEnd,
  onScrubCancel,
  "aria-label": ariaLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [padOpen, setPadOpen] = useState(false);
  const numberPad = usePreferences((s) => s.input.numberPad);
  const coarse = useCoarsePointer();
  // "auto" is the case the pad was built for: a finger on an iPad, where the
  // OS keyboard would shift the whole viewport.
  const usePad =
    !disabled && (numberPad === "always" || (numberPad === "auto" && coarse));
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
      if (!isScrub(dx)) return; // tolerate jitter so clicks still edit
      d.scrubbing = true;
      onScrubStart?.();
      inputRef.current?.blur();
      inputRef.current?.setPointerCapture(d.pointerId);
    }
    onChange(
      clamp(
        scrubbedValue({
          scale,
          startValue: d.startValue,
          dx,
          step,
          modifier: e.shiftKey ? "coarse" : e.altKey ? "fine" : "none",
        })
      )
    );
  };

  const onPointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.scrubbing) {
      inputRef.current?.releasePointerCapture(d.pointerId);
      onScrubEnd?.();
    } else if (usePad) {
      // A plain tap opens the pad — and taps it shut again.
      setPadOpen((open) => !open);
    } else {
      // A plain click/tap: focus for text editing.
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    e.preventDefault();
  };

  const onPointerCancel = () => {
    // Touch gestures can be interrupted; just drop the scrub without editing.
    if (drag.current?.scrubbing) onScrubCancel?.();
    drag.current = null;
  };

  const onDoubleClick = () => {
    if (defaultValue == null) return;
    onChange(clamp(defaultValue));
    setPadOpen(false);
    inputRef.current?.blur();
  };

  const field = (
    <input
      ref={inputRef}
      type="number"
      // Read-only while the pad owns entry: an editable field is what raises
      // the software keyboard, and the pad exists to avoid it. The type stays
      // `number` — as text the field would claim a 20-character default width
      // and widen every panel it sits in.
      {...(usePad ? { readOnly: true } : {})}
      className={className}
      // touchAction none: keep the horizontal scrub gesture from scrolling the
      // panel and cancelling the pointer mid-drag on touch devices.
      style={{
        cursor: disabled ? "default" : "ew-resize",
        touchAction: "none",
        // Keep the digits clear of the unit sitting in the field's padding.
        ...(unit ? { paddingRight: `calc(${unit.length}ch + 10px)` } : {}),
      }}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(clamp(v));
      }}
    />
  );

  return (
    <>
      {unit ? (
        <span className="scrub-field">
          {field}
          <span className="scrub-unit" aria-hidden>
            {unit}
          </span>
        </span>
      ) : (
        field
      )}
      {padOpen && (
        <NumberPad
          anchor={inputRef.current}
          value={value}
          min={min}
          max={max}
          step={step}
          label={ariaLabel}
          {...(unit ? { unit } : {})}
          onCommit={(v) => {
            // One committed entry, so one undo step — never a value per keypress.
            onChange(clamp(v));
            setPadOpen(false);
          }}
          onCancel={() => setPadOpen(false)}
        />
      )}
    </>
  );
}
