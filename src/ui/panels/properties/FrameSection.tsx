import type { FrameNode } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ColorInput from "@/ui/controls/ColorInput";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import Section from "../Section";

const FRAME_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "Square", w: 1080, h: 1080 },
  { label: "16:9", w: 1920, h: 1080 },
  { label: "A4", w: 794, h: 1123 },
];

/** Frame geometry and background. `x`/`y` are its world top-left (the frame
 *  transform's translation; frames are top-level and axis-aligned). The name
 *  lives in the selection header and deletion in the Arrange section, like
 *  every other node. */
export default function FrameSection({ frame }: { frame: FrameNode }) {
  const update = useEditor((state) => state.updateFrame);
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
    <>
      <Section id="properties.frameSize" title="Size">
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
      </Section>

      <Section id="properties.frameBackground" title="Background">
        <div className="field">
          <div className="field-row">
            <ColorInput
              value={transparent ? "#ffffff" : frame.background ?? "#ffffff"}
              title="Frame background"
              onChange={(hex) => update(frame.id, { background: hex })}
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
              checked={frame.clipsContent}
              onChange={(event) => update(frame.id, { clipsContent: event.target.checked })}
            />
            Clip content
          </label>
        </div>
      </Section>
    </>
  );
}
