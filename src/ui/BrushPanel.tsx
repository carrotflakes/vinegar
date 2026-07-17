import { useBrush } from "../store/brushStore";
import ScrubbableNumber from "./ScrubbableNumber";
import "./Panel.css";

/** Tool options for the Brush tool. Shown while the brush tool is active. */
export default function BrushPanel() {
  const { size, pressureGamma, minWidth, stabilizer, taper, setBrush } =
    useBrush();

  return (
    <div className="panel-section">
      <div className="panel-title">Brush</div>

      <div className="field">
        <label>Size</label>
        <div className="field-row">
          <input
            type="range"
            min={0.5}
            max={80}
            step={0.5}
            value={size}
            onChange={(e) => setBrush({ size: Number(e.target.value) })}
          />
          <ScrubbableNumber
            className="num"
            min={0.5}
            step={0.5}
            value={size}
            onChange={(v) => setBrush({ size: v })}
            aria-label="Brush size"
          />
        </div>
      </div>

      <div className="field">
        <label>Min width</label>
        <div className="field-row">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={minWidth}
            onChange={(e) => setBrush({ minWidth: Number(e.target.value) })}
          />
          <span className="num readout">{Math.round(minWidth * 100)}%</span>
        </div>
      </div>

      <div className="field">
        <label>Pressure</label>
        <div className="field-row">
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.05}
            value={pressureGamma}
            onChange={(e) => setBrush({ pressureGamma: Number(e.target.value) })}
          />
          <ScrubbableNumber
            className="num"
            min={0.25}
            max={4}
            step={0.05}
            value={pressureGamma}
            onChange={(v) => setBrush({ pressureGamma: v })}
            aria-label="Pressure response"
          />
        </div>
      </div>

      <div className="field">
        <label>Smoothing</label>
        <div className="field-row">
          <input
            type="range"
            min={0}
            max={0.95}
            step={0.01}
            value={stabilizer}
            onChange={(e) => setBrush({ stabilizer: Number(e.target.value) })}
          />
          <span className="num readout">{Math.round(stabilizer * 100)}%</span>
        </div>
      </div>

      <div className="field">
        <label>Taper</label>
        <div className="field-row">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={taper}
            onChange={(e) => setBrush({ taper: Number(e.target.value) })}
          />
          <ScrubbableNumber
            className="num"
            min={0}
            step={1}
            value={taper}
            onChange={(v) => setBrush({ taper: v })}
            aria-label="Taper length"
          />
        </div>
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
      <div className="field">
        <label>Size</label>
        <div className="field-row">
          <input
            type="range"
            min={1}
            max={120}
            step={1}
            value={eraserSize}
            onChange={(e) => setBrush({ eraserSize: Number(e.target.value) })}
          />
          <ScrubbableNumber
            className="num"
            min={1}
            step={1}
            value={eraserSize}
            onChange={(v) => setBrush({ eraserSize: v })}
            aria-label="Eraser size"
          />
        </div>
      </div>
    </div>
  );
}
