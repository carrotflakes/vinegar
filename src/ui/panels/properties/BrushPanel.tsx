import { useBrush } from "../../../store/brushStore";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import "../../Panel.css";

/** Tool options for the Brush tool. Shown while the brush tool is active. */
export default function BrushPanel() {
  const { size, pressureGamma, minWidth, stabilizer, taper, setBrush } =
    useBrush();

  return (
    <div className="panel-section">
      <div className="panel-title">Brush</div>

      <div className="brush-options-grid">
        <label>
          <span>Size</span>
          <ScrubbableNumber
            className="num"
            min={0.5}
            step={0.5}
            value={size}
            onChange={(v) => setBrush({ size: v })}
            aria-label="Brush size"
          />
        </label>

        <label>
          <span>Min width (%)</span>
          <ScrubbableNumber
            className="num"
            min={0}
            max={100}
            step={1}
            value={Math.round(minWidth * 100)}
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
            onChange={(v) => setBrush({ pressureGamma: v })}
            aria-label="Pressure response"
          />
        </label>

        <label>
          <span>Smoothing (%)</span>
          <ScrubbableNumber
            className="num"
            min={0}
            max={95}
            step={1}
            value={Math.round(stabilizer * 100)}
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
            onChange={(v) => setBrush({ taper: v })}
            aria-label="Taper length"
          />
        </label>
      </div>
    </div>
  );
}

/** Tool options for the Eraser tool. Shown while the eraser tool is active. */
export function EraserPanel() {
  const { eraserSize, setBrush } = useBrush();
  return (
    <div className="panel-section">
      <div className="panel-title">Eraser</div>
      <div className="brush-options-grid">
        <label>
          <span>Size</span>
          <ScrubbableNumber
            className="num"
            min={1}
            step={1}
            value={eraserSize}
            onChange={(v) => setBrush({ eraserSize: v })}
            aria-label="Eraser size"
          />
        </label>
      </div>
    </div>
  );
}
