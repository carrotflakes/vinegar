import { LuPipette } from "react-icons/lu";
import { useEditor } from "@/store/editorStore";
import ColorPickerCore from "./ColorPickerCore";
import HexInput from "./HexInput";
import "./ColorPicker.css";

/** A curated default palette (grayscale + a hue wheel + tints). */
const PALETTE = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#efefef", "#ffffff",
  "#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#3949ab", "#8e24aa", "#d81b60",
  "#ffcdd2", "#ffe0b2", "#fff9c4", "#c8e6c9", "#bbdefb", "#c5cae9", "#e1bee7", "#f8bbd0",
];

interface Props {
  /** Current colour as `#rrggbb`. */
  value: string;
  onChange: (hex: string) => void;
  /** Opacity track; omitted when the caller has no alpha to edit. */
  alpha?: number;
  onAlphaChange?: (alpha: number) => void;
  /** Show a numeric alpha readout after the hex input. */
  showAlphaValue?: boolean;
}

/** Complete app colour picker shared by paint fields and compact colour inputs. */
export default function ColorPicker({
  value,
  onChange,
  alpha,
  onAlphaChange,
  showAlphaValue,
}: Props) {
  const recentColors = useEditor((s) => s.recentColors);
  const savedSwatches = useEditor((s) => s.savedSwatches);
  const addSwatch = useEditor((s) => s.addSwatch);
  const removeSwatch = useEditor((s) => s.removeSwatch);
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

  return (
    <div className="color-picker-panel">
      <ColorPickerCore
        value={value}
        onChange={onChange}
        {...(alpha != null && onAlphaChange ? { alpha, onAlphaChange } : {})}
      >
        {hasEyeDropper && (
          <button
            type="button"
            className="icon-btn"
            title="Pick color from screen"
            onClick={pickFromScreen}
          >
            <LuPipette aria-hidden />
          </button>
        )}
        <HexInput value={value} onChange={onChange} />
        {showAlphaValue && alpha != null && (
          <span className="alpha-value">{Math.round(alpha * 100)}%</span>
        )}
      </ColorPickerCore>

      <div className="color-pop-label">
        Saved
        <button
          type="button"
          className="swatch-add"
          title="Save current color"
          onClick={() => addSwatch(value)}
        >
          +
        </button>
      </div>
      <div className="swatch-grid">
        {savedSwatches.length === 0 && (
          <span className="swatch-hint">Save colors with +</span>
        )}
        {savedSwatches.map((color) => (
          <button
            type="button"
            key={color}
            className="mini-swatch"
            style={{ background: color }}
            title={`${color} — Alt-click to remove`}
            onClick={(event) =>
              event.altKey ? removeSwatch(color) : onChange(color)
            }
          />
        ))}
      </div>

      {recentColors.length > 0 && (
        <>
          <div className="color-pop-label">Recent</div>
          <div className="swatch-grid">
            {recentColors.map((color) => (
              <button
                type="button"
                key={color}
                className="mini-swatch"
                style={{ background: color }}
                title={color}
                onClick={() => onChange(color)}
              />
            ))}
          </div>
        </>
      )}

      <div className="color-pop-label">Palette</div>
      <div className="swatch-grid">
        {PALETTE.map((color) => (
          <button
            type="button"
            key={color}
            className="mini-swatch"
            style={{ background: color }}
            title={color}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </div>
  );
}
