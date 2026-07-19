import type { TextShape } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import { FONT_OPTIONS } from "../../../fonts";
import ScrubbableNumber from "../../ScrubbableNumber";

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export default function TextSection({ shape }: { shape: TextShape }) {
  const update = useEditor((state) => state.updateTextShape);

  return (
    <div className="panel-section">
      <div className="panel-title">Text</div>
      <div className="field">
        <label>Font</label>
        <select
          className="blend-select"
          value={shape.fontFamily}
          onChange={(event) =>
            update(shape.id, { fontFamily: event.target.value })
          }
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font.name} value={font.name}>
              {font.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Size</label>
        <div className="field-row">
          <ScrubbableNumber
            className="num"
            min={1}
            step={1}
            value={shape.fontSize}
            onChange={(value) =>
              update(shape.id, { fontSize: value })
            }
            aria-label="Font size"
          />
          <select
            className="blend-select"
            value={shape.fontWeight}
            onChange={(event) =>
              update(shape.id, {
                fontWeight: Number(event.target.value),
              })
            }
          >
            {FONT_WEIGHTS.map((weight) => (
              <option key={weight} value={weight}>{weight}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={shape.italic}
            onChange={(event) =>
              update(shape.id, { italic: event.target.checked })
            }
          />
          Italic
        </label>
      </div>
      <div className="field">
        <label>Line height</label>
        <ScrubbableNumber
          className="num"
          min={0.5}
          step={0.1}
          value={shape.lineHeight}
          onChange={(value) =>
            update(shape.id, { lineHeight: value })
          }
          aria-label="Line height"
        />
      </div>
      <div className="field">
        <label>Align</label>
        <select
          className="blend-select"
          value={shape.align}
          onChange={(event) =>
            update(shape.id, {
              align: event.target.value as TextShape["align"],
            })
          }
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
      {shape.textMode === "area" && (
        <div className="field">
          <label>Wrapping width</label>
          <ScrubbableNumber
            className="num"
            min={1}
            step={1}
            value={Math.round(shape.width)}
            onChange={(value) =>
              update(shape.id, { width: value })
            }
            aria-label="Wrapping width"
          />
        </div>
      )}
    </div>
  );
}
