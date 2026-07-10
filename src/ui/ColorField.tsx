import { useEffect, useRef, useState } from "react";
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

function Eyedropper() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M10.5 2.5a1.8 1.8 0 0 1 2.5 2.5l-1.2 1.2 1 1-1 1-1-1L6 13l-2.5.5L4 11l5.3-5.3-1-1 1-1 1 1 .2-1.2Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface Props {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
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
  const hasEyeDropper = typeof window !== "undefined" && !!window.EyeDropper;

  const pickFromScreen = async () => {
    if (!window.EyeDropper) return;
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      onChange(sRGBHex.toLowerCase());
    } catch {
      // user cancelled
    }
  };

  const close = () => {
    setOpen(false);
    if (value) addRecentColor(value);
  };

  // Dismiss on outside press or Escape. Uses pointerdown (not mousedown):
  // the canvas captures pointers on pointerdown, which suppresses the
  // compatibility mouse events a mousedown listener would rely on.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
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
          className={"color-swatch" + (enabled ? "" : " is-none")}
          style={enabled ? { background: value } : undefined}
          onClick={() => setOpen((o) => !o)}
          title="Edit color"
        />
        <span className="swatch-text">{enabled ? value : "none"}</span>
      </div>

      {open && (
        <div className="color-popover">
          <div className="color-pop-row">
            <button
              className={"none-btn" + (enabled ? "" : " active")}
              onClick={() => onChange(null)}
            >
              None
            </button>
            <input
              type="color"
              className="color-spectrum"
              value={enabled ? value : "#888888"}
              onChange={(e) => onChange(e.target.value)}
            />
            {hasEyeDropper && (
              <button
                className="icon-btn"
                title="Pick color from screen"
                onClick={pickFromScreen}
              >
                <Eyedropper />
              </button>
            )}
            <input
              key={value ?? "none"}
              className="hex-input"
              defaultValue={enabled ? value.replace("#", "") : ""}
              placeholder="rrggbb"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const n = normalizeHex(e.target.value);
                if (n) onChange(n);
              }}
            />
          </div>

          <div className="color-pop-label">
            Saved
            <button
              className="swatch-add"
              title="Save current color"
              disabled={!enabled}
              onClick={() => enabled && addSwatch(value)}
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
                onClick={(e) =>
                  e.altKey ? removeSwatch(c) : onChange(c)
                }
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
                    onClick={() => onChange(c)}
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
                onClick={() => onChange(c)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
