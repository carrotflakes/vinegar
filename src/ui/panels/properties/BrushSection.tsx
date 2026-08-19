import { useBrush, BRUSH_DEFAULTS } from "../../../store/brushStore";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import "../../Panel.css";
import Section from "../Section";

/** Tool options for the Brush tool. Shown while the brush tool is active. */
export default function BrushSection() {
  const { size, pressureGamma, minWidth, stabilizer, taper, simplify, setBrush } =
    useBrush();

  return (
    <Section id="properties.brush" title="Brush">
      <div className="brush-options-grid">
        <label>
          <span>Size</span>
          <ScrubbableNumber
            className="num"
            min={0.5}
            step={0.5}
            unit="px"
            value={size}
            defaultValue={BRUSH_DEFAULTS.size}
            onChange={(v) => setBrush({ size: v })}
            aria-label="Brush size"
          />
        </label>

        <label>
          <span>Min width</span>
          <ScrubbableNumber
            className="num"
            min={0}
            max={100}
            step={1}
            unit="%"
            value={Math.round(minWidth * 100)}
            defaultValue={Math.round(BRUSH_DEFAULTS.minWidth * 100)}
            onChange={(v) => setBrush({ minWidth: v / 100 })}
            aria-label="Minimum width percent"
          />
        </label>

        <label>
          <span>Pressure</span>
          <ScrubbableNumber
            className="num"
            min={0.25}
            max={4}
            step={0.05}
            value={pressureGamma}
            defaultValue={BRUSH_DEFAULTS.pressureGamma}
            onChange={(v) => setBrush({ pressureGamma: v })}
            aria-label="Pressure response"
          />
        </label>

        <label>
          <span>Smoothing</span>
          <ScrubbableNumber
            className="num"
            min={0}
            max={95}
            step={1}
            unit="%"
            value={Math.round(stabilizer * 100)}
            defaultValue={Math.round(BRUSH_DEFAULTS.stabilizer * 100)}
            onChange={(v) => setBrush({ stabilizer: v / 100 })}
            aria-label="Smoothing percent"
          />
        </label>

        <label>
          <span>Taper</span>
          <ScrubbableNumber
            className="num"
            min={0}
            step={1}
            value={taper}
            defaultValue={BRUSH_DEFAULTS.taper}
            onChange={(v) => setBrush({ taper: v })}
            aria-label="Taper length"
          />
        </label>

        <label>
          <span>Simplify</span>
          <ScrubbableNumber
            className="num"
            min={0}
            max={20}
            step={0.5}
            unit="px"
            value={simplify}
            defaultValue={BRUSH_DEFAULTS.simplify}
            onChange={(v) => setBrush({ simplify: v })}
            aria-label="Simplify tolerance in pixels"
          />
        </label>
      </div>
    </Section>
  );
}

/** Tool options for the Eraser tool. Shown while the eraser tool is active. */
export function EraserSection() {
  const { eraserSize, setBrush } = useBrush();
  return (
    <Section id="properties.eraser" title="Eraser">
      <div className="brush-options-grid">
        <label>
          <span>Size</span>
          <ScrubbableNumber
            className="num"
            min={1}
            step={1}
            unit="px"
            value={eraserSize}
            defaultValue={BRUSH_DEFAULTS.eraserSize}
            onChange={(v) => setBrush({ eraserSize: v })}
            aria-label="Eraser size"
          />
        </label>
      </div>
    </Section>
  );
}
