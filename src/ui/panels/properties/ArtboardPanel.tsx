import type { Artboard } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ScrubbableNumber from "../../ScrubbableNumber";

const ARTBOARD_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "Square", w: 1080, h: 1080 },
  { label: "16:9", w: 1920, h: 1080 },
  { label: "A4", w: 794, h: 1123 },
];

export default function ArtboardPanel({ artboard }: { artboard: Artboard }) {
  const update = useEditor((state) => state.updateArtboard);
  const remove = useEditor((state) => state.deleteArtboard);
  const transparent = artboard.background === null;

  const field = (key: "x" | "y" | "width" | "height", label: string) => (
    <label className="geo-field">
      <span>{label}</span>
      <ScrubbableNumber
        value={Math.round(artboard[key])}
        aria-label={label}
        onChange={(next) => update(artboard.id, { [key]: next })}
      />
    </label>
  );

  return (
    <div className="panel">
      <div className="panel-section">
        <div className="panel-title">Artboard</div>
        <div className="field">
          <label>Name</label>
          <div className="field-row">
            <input
              type="text"
              className="artboard-name"
              value={artboard.name}
              onChange={(event) =>
                update(artboard.id, { name: event.target.value })
              }
            />
          </div>
        </div>
        <div className="geometry-grid">
          {field("x", "X")}
          {field("y", "Y")}
          {field("width", "W")}
          {field("height", "H")}
        </div>
        <div className="btn-row">
          {ARTBOARD_PRESETS.map((preset) => (
            <button
              key={preset.label}
              className="ghost-btn"
              onClick={() =>
                update(artboard.id, {
                  width: preset.w,
                  height: preset.h,
                })
              }
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Background</div>
        <div className="field">
          <div className="field-row">
            <input
              type="color"
              value={transparent ? "#ffffff" : artboard.background ?? "#ffffff"}
              onChange={(event) =>
                update(artboard.id, { background: event.target.value })
              }
            />
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(event) =>
                  update(artboard.id, {
                    background: event.target.checked ? null : "#ffffff",
                  })
                }
              />
              Transparent
            </label>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="btn-row">
          <button
            className="ghost-btn danger"
            onClick={() => remove(artboard.id)}
          >
            Delete artboard
          </button>
        </div>
      </div>
    </div>
  );
}
