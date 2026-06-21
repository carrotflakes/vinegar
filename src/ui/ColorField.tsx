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

interface Props {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}

export default function ColorField({ label, value, onChange }: Props) {
  const recentColors = useEditor((s) => s.recentColors);
  const addRecentColor = useEditor((s) => s.addRecentColor);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const enabled = value !== null;

  const close = () => {
    setOpen(false);
    if (value) addRecentColor(value);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
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
            <input
              key={value ?? "none"}
              className="hex-input"
              defaultValue={enabled ? value.replace("#", "") : ""}
              placeholder="rrggbb"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setOpen(false);
              }}
              onBlur={(e) => {
                const n = normalizeHex(e.target.value);
                if (n) onChange(n);
              }}
            />
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
