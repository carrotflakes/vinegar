import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react-dom";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuPipette } from "react-icons/lu";
import {
  isGradient,
  linearGradient,
  paintToCss,
  radialGradient,
  solid,
  stopsToCssBar,
  type GradientStop,
  type Paint,
} from "../model/paint";
import { useEditor } from "../store/editorStore";

/** A curated default palette (grayscale + a hue wheel + tints). */
const PALETTE = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#efefef", "#ffffff",
  "#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#3949ab", "#8e24aa", "#d81b60",
  "#ffcdd2", "#ffe0b2", "#fff9c4", "#c8e6c9", "#bbdefb", "#c5cae9", "#e1bee7", "#f8bbd0",
];

/** Normalize user-entered hex (#rgb or #rrggbb) to #rrggbb, or null if invalid. */
function normalizeHex(input: string): string | null {
  let v = input.trim().toLowerCase();
  if (!v.startsWith("#")) v = "#" + v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    v = "#" + v.slice(1).split("").map((c) => c + c).join("");
  }
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

interface Props {
  label: string;
  value: Paint | null;
  onChange: (v: Paint | null) => void;
}

export default function ColorField({ label, value, onChange }: Props) {
  const recentColors = useEditor((s) => s.recentColors);
  const addRecentColor = useEditor((s) => s.addRecentColor);
  const savedSwatches = useEditor((s) => s.savedSwatches);
  const addSwatch = useEditor((s) => s.addSwatch);
  const removeSwatch = useEditor((s) => s.removeSwatch);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const enabled = value !== null;
  const kind = value === null ? "none" : value.type; // none|solid|linear|radial
  // Colour and alpha are edited independently; a paint keeps its alpha when the
  // colour changes (and vice-versa). Swatches/recents/palette store colours.
  const gradient = value && isGradient(value) ? value : null;
  const color =
    value && value.type === "solid"
      ? value.color
      : gradient
        ? gradient.stops[0]?.color ?? "#888888"
        : "#888888";
  const alpha = value && value.type === "solid" ? value.alpha : 1;
  const setColor = (hex: string) => onChange(solid(hex, alpha));
  const setAlpha = (a: number) => onChange(solid(color, a));
  const hasEyeDropper = typeof window !== "undefined" && !!window.EyeDropper;

  // ---- gradient editing --------------------------------------------------
  const stops: GradientStop[] = gradient
    ? gradient.stops
    : [
        { offset: 0, color, alpha: 1 },
        { offset: 1, color: "#ffffff", alpha: 1 },
      ];
  const angle = value && value.type === "linear" ? value.angle : 0;
  const setStops = (next: GradientStop[]) =>
    onChange(kind === "radial" ? radialGradient(next) : linearGradient(next, angle));
  const updateStop = (i: number, patch: Partial<GradientStop>) =>
    setStops(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStop = () =>
    setStops([...stops, { offset: 0.5, color: "#888888", alpha: 1 }]);
  const removeStop = (i: number) =>
    stops.length > 2 && setStops(stops.filter((_, j) => j !== i));

  const setKind = (next: "none" | "solid" | "linear" | "radial") => {
    if (next === "none") return onChange(null);
    if (next === "solid") return onChange(solid(color, alpha));
    if (next === "linear") return onChange(linearGradient(stops, angle));
    return onChange(radialGradient(stops));
  };

  // The popover portals to <body> so the sidebar's overflow can't clip it;
  // Floating UI keeps it anchored to the swatch (and inside the viewport).
  const { refs, floatingStyles } = useFloating({
    placement: "bottom-start",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const pickFromScreen = async () => {
    if (!window.EyeDropper) return;
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      setColor(sRGBHex.toLowerCase());
    } catch {
      // user cancelled
    }
  };

  const close = () => {
    setOpen(false);
    if (enabled) addRecentColor(color);
  };

  // Dismiss on outside press or Escape. Uses pointerdown (not mousedown):
  // the canvas captures pointers on pointerdown, which suppresses the
  // compatibility mouse events a mousedown listener would rely on.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (refs.floating.current?.contains(t)) return; // popover lives in a portal
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture phase: closing the popover shouldn't also clear selection.
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  return (
    <div className="field color-field" ref={rootRef}>
      <label>{label}</label>
      <div className="field-row">
        <button
          ref={refs.setReference}
          className={"color-swatch" + (enabled ? "" : " is-none")}
          onClick={() => setOpen((o) => !o)}
          title="Edit color"
        >
          {value && (
            <span
              className="swatch-fill"
              style={{ background: paintToCss(value) }}
            />
          )}
        </button>
        <span className="swatch-text">
          {kind === "none"
            ? "none"
            : kind === "solid"
              ? alpha < 1
                ? `${color} · ${Math.round(alpha * 100)}%`
                : color
              : kind === "linear"
                ? "Linear"
                : "Radial"}
        </span>
      </div>

      {open &&
        createPortal(
          <div
            className="color-popover"
            ref={refs.setFloating}
            style={floatingStyles}
          >
          <div className="paint-type-row">
            {(["none", "solid", "linear", "radial"] as const).map((t) => (
              <button
                key={t}
                className={"paint-type-btn" + (kind === t ? " active" : "")}
                onClick={() => setKind(t)}
              >
                {t === "none"
                  ? "None"
                  : t === "solid"
                    ? "Solid"
                    : t === "linear"
                      ? "Linear"
                      : "Radial"}
              </button>
            ))}
          </div>

          {kind === "solid" && (
            <>
              <div className="color-pop-row">
                <input
                  type="color"
                  className="color-spectrum"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
                {hasEyeDropper && (
                  <button
                    className="icon-btn"
                    title="Pick color from screen"
                    onClick={pickFromScreen}
                  >
                    <LuPipette aria-hidden />
                  </button>
                )}
                <input
                  key={color}
                  className="hex-input"
                  defaultValue={color.replace("#", "")}
                  placeholder="rrggbb"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  onBlur={(e) => {
                    const n = normalizeHex(e.target.value);
                    if (n) setColor(n);
                  }}
                />
              </div>

              <div className="color-pop-alpha">
                <span className="alpha-label">Alpha</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(alpha * 100)}
                  onChange={(e) => setAlpha(Number(e.target.value) / 100)}
                />
                <span className="alpha-value">{Math.round(alpha * 100)}%</span>
              </div>

              <div className="color-pop-label">
                Saved
                <button
                  className="swatch-add"
                  title="Save current color"
                  onClick={() => addSwatch(color)}
                >
                  +
                </button>
              </div>
              <div className="swatch-grid">
                {savedSwatches.length === 0 && (
                  <span className="swatch-hint">Save colors with +</span>
                )}
                {savedSwatches.map((c) => (
                  <button
                    key={c}
                    className="mini-swatch"
                    style={{ background: c }}
                    title={`${c} — Alt-click to remove`}
                    onClick={(e) => (e.altKey ? removeSwatch(c) : setColor(c))}
                  />
                ))}
              </div>

              {recentColors.length > 0 && (
                <>
                  <div className="color-pop-label">Recent</div>
                  <div className="swatch-grid">
                    {recentColors.map((c) => (
                      <button
                        key={c}
                        className="mini-swatch"
                        style={{ background: c }}
                        title={c}
                        onClick={() => setColor(c)}
                      />
                    ))}
                  </div>
                </>
              )}

              <div className="color-pop-label">Palette</div>
              <div className="swatch-grid">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    className="mini-swatch"
                    style={{ background: c }}
                    title={c}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </>
          )}

          {gradient && (
            <>
              <div
                className="gradient-bar"
                style={{ background: stopsToCssBar(stops) }}
              />
              {kind === "linear" && (
                <div className="color-pop-alpha">
                  <span className="alpha-label">Angle</span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={Math.round((angle * 180) / Math.PI)}
                    onChange={(e) =>
                      onChange(
                        linearGradient(
                          stops,
                          (Number(e.target.value) * Math.PI) / 180
                        )
                      )
                    }
                  />
                  <span className="alpha-value">
                    {Math.round((angle * 180) / Math.PI)}°
                  </span>
                </div>
              )}
              <div className="color-pop-label">
                Stops
                <button
                  className="swatch-add"
                  title="Add a stop"
                  onClick={addStop}
                >
                  +
                </button>
              </div>
              {stops.map((s, i) => (
                <div className="gradient-stop" key={i}>
                  <input
                    type="color"
                    className="stop-color"
                    value={s.color}
                    onChange={(e) => updateStop(i, { color: e.target.value })}
                  />
                  <input
                    type="range"
                    className="stop-offset"
                    min={0}
                    max={100}
                    value={Math.round(s.offset * 100)}
                    onChange={(e) =>
                      updateStop(i, { offset: Number(e.target.value) / 100 })
                    }
                    title="Position"
                  />
                  <input
                    type="range"
                    className="stop-alpha"
                    min={0}
                    max={100}
                    value={Math.round(s.alpha * 100)}
                    onChange={(e) =>
                      updateStop(i, { alpha: Number(e.target.value) / 100 })
                    }
                    title="Alpha"
                  />
                  <button
                    className="stop-remove"
                    title="Remove stop"
                    disabled={stops.length <= 2}
                    onClick={() => removeStop(i)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}
