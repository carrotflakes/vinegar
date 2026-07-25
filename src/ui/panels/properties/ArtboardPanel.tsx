import type { FrameNode } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";

const FRAME_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "Square", w: 1080, h: 1080 },
  { label: "16:9", w: 1920, h: 1080 },
  { label: "A4", w: 794, h: 1123 },
];

/** Properties for the selected frame node. `x`/`y` are its world top-left (the
 *  frame transform's translation; frames are top-level and axis-aligned). */
export default function ArtboardPanel({ frame }: { frame: FrameNode }) {
  const update = useEditor((state) => state.updateFrame);
  const rename = useEditor((state) => state.renameNode);
  const setSelection = useEditor((state) => state.setSelection);
  const remove = useEditor((state) => state.deleteSelected);
  const transparent = frame.background === null;
  const pos = { x: frame.transform[4], y: frame.transform[5] };

  const field = (key: "x" | "y" | "width" | "height", label: string) => {
    const value =
      key === "x" ? pos.x : key === "y" ? pos.y : frame[key];
    return (
      <label className="geo-field">
        <span>{label}</span>
        <ScrubbableNumber
          min={key === "width" || key === "height" ? 1 : undefined}
          value={Math.round(value)}
          aria-label={label}
          onChange={(next) => update(frame.id, { [key]: next })}
        />
      </label>
    );
  };

  return (
    <div className="panel">
      <div className="panel-section">
        <div className="panel-title">Frame</div>
        <div className="field">
          <label>Name</label>
          <div className="field-row">
            <input
              type="text"
              className="artboard-name"
              value={frame.name}
              onChange={(event) => rename(frame.id, event.target.value)}
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
          {FRAME_PRESETS.map((preset) => (
            <button
              key={preset.label}
              className="ghost-btn"
              onClick={() =>
                update(frame.id, { width: preset.w, height: preset.h })
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
              value={transparent ? "#ffffff" : frame.background ?? "#ffffff"}
              onChange={(event) =>
                update(frame.id, { background: event.target.value })
              }
            />
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(event) =>
                  update(frame.id, {
                    background: event.target.checked ? null : "#ffffff",
                  })
                }
              />
              Transparent
            </label>
          </div>
        </div>
        <div className="field">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={frame.clip ?? true}
              onChange={(event) => update(frame.id, { clip: event.target.checked })}
            />
            Clip content
          </label>
        </div>
      </div>

      <div className="panel-section">
        <div className="btn-row">
          <button
            className="ghost-btn danger"
            onClick={() => {
              setSelection([frame.id]);
              remove();
            }}
          >
            Delete frame
          </button>
        </div>
      </div>
    </div>
  );
}
