import { useRef, useState } from "react";
import { hexToHsv, hsvToHex, type Hsv } from "@/model/color";
import "./ColorPicker.css";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

interface Props {
  /** Current colour as `#rrggbb`. */
  value: string;
  onChange: (hex: string) => void;
  /** Opacity track; omitted when the caller has no alpha to edit. */
  alpha?: number;
  onAlphaChange?: (alpha: number) => void;
  /** Extra controls rendered next to the preview (eyedropper, hex field…). */
  children?: React.ReactNode;
}

/** Saturation/value square plus hue (and optional alpha) sliders.
 *
 * Hue and saturation vanish from the hex once a colour reaches black or full
 * white, so the HSV the user is dragging is held here and only re-derived from
 * `value` when that prop names a different colour than the one we last emitted.
 * Without it the thumb would jump to red the moment value hits #000000. */
export default function ColorPicker({
  value,
  onChange,
  alpha,
  onAlphaChange,
  children,
}: Props) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  // Sync from the outside (swatch clicks, undo, a different shape selected).
  const emitted = useRef(value);
  if (value.toLowerCase() !== emitted.current.toLowerCase()) {
    emitted.current = value;
    const next = hexToHsv(value);
    // Keep the dragged hue on grays/blacks, which carry none of their own.
    setHsv((prev) => ({
      h: next.s === 0 ? prev.h : next.h,
      s: next.v === 0 ? prev.s : next.s,
      v: next.v,
    }));
  }

  const apply = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    emitted.current = hex;
    onChange(hex);
  };

  const hueHex = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const hex = hsvToHex(hsv);

  // Pointer drags: capture on the track so the gesture survives leaving it.
  const track = (
    el: HTMLElement,
    e: React.PointerEvent,
    onPos: (x: number, y: number) => void
  ) => {
    const r = el.getBoundingClientRect();
    onPos(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  };
  const dragHandlers = (onPos: (x: number, y: number) => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      track(e.currentTarget, e, onPos);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      track(e.currentTarget, e, onPos);
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    },
  });

  // Arrow keys nudge; Shift for a coarser step.
  const keyStep = (e: React.KeyboardEvent, step: number, apply2: (dx: number, dy: number) => void) => {
    const s = e.shiftKey ? step * 5 : step;
    if (e.key === "ArrowLeft") apply2(-s, 0);
    else if (e.key === "ArrowRight") apply2(s, 0);
    else if (e.key === "ArrowUp") apply2(0, -s);
    else if (e.key === "ArrowDown") apply2(0, s);
    else return;
    e.preventDefault();
  };

  return (
    <div className="color-picker">
      <div
        className="cp-area"
        style={{ backgroundColor: hueHex }}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
        onKeyDown={(e) =>
          keyStep(e, 0.02, (dx, dy) =>
            apply({ ...hsv, s: clamp01(hsv.s + dx), v: clamp01(hsv.v - dy) })
          )
        }
        {...dragHandlers((x, y) => apply({ ...hsv, s: x, v: 1 - y }))}
      >
        <span className="cp-area-sat" />
        <span className="cp-area-val" />
        <span
          className="cp-thumb"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: hex,
          }}
        />
      </div>

      <div className="cp-sliders">
        <span className="cp-preview" title={hex}>
          <span
            className="cp-preview-fill"
            style={{ backgroundColor: hex, opacity: alpha ?? 1 }}
          />
        </span>
        <div className="cp-tracks">
          <div
            className="cp-hue"
            role="slider"
            tabIndex={0}
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            onKeyDown={(e) =>
              keyStep(e, 2, (dx, dy) => apply({ ...hsv, h: (hsv.h + dx + dy + 360) % 360 }))
            }
            {...dragHandlers((x) => apply({ ...hsv, h: x * 360 }))}
          >
            <span
              className="cp-thumb"
              style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hueHex }}
            />
          </div>
          {alpha != null && onAlphaChange && (
            <div
              className="cp-alpha"
              role="slider"
              tabIndex={0}
              aria-label="Alpha"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(alpha * 100)}
              onKeyDown={(e) =>
                keyStep(e, 0.02, (dx, dy) => onAlphaChange(clamp01(alpha + dx - dy)))
              }
              {...dragHandlers((x) => onAlphaChange(x))}
            >
              <span
                className="cp-alpha-fill"
                style={{ backgroundImage: `linear-gradient(to right, transparent, ${hex})` }}
              />
              <span
                className="cp-thumb"
                style={{ left: `${alpha * 100}%`, backgroundColor: hex }}
              />
            </div>
          )}
        </div>
      </div>

      {children && <div className="cp-extras">{children}</div>}
    </div>
  );
}
