import {
  usePencil,
  PENCIL_DEFAULTS,
  type PencilCloseMode,
} from "../../../store/pencilStore";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import "../../Panel.css";
import Section from "../Section";

/** Tool options for the Pencil (freehand) tool. Shown while it is active. */
export default function PencilSection() {
  const { smoothing, simplify, close, setPencil } = usePencil();

  return (
    <Section title="Pencil">
      <div className="brush-options-grid">
        <label>
          <span>Smoothing (%)</span>
          <ScrubbableNumber
            className="num"
            min={0}
            max={95}
            step={1}
            value={Math.round(smoothing * 100)}
            defaultValue={Math.round(PENCIL_DEFAULTS.smoothing * 100)}
            onChange={(v) => setPencil({ smoothing: v / 100 })}
            aria-label="Smoothing percent"
          />
        </label>

        <label>
          <span>Simplify (px)</span>
          <ScrubbableNumber
            className="num"
            min={0}
            max={20}
            step={0.5}
            value={simplify}
            defaultValue={PENCIL_DEFAULTS.simplify}
            onChange={(v) => setPencil({ simplify: v })}
            aria-label="Simplify tolerance in pixels"
          />
        </label>

        <label>
          <span>Close</span>
          <select
            className="blend-select"
            value={close}
            onChange={(event) =>
              setPencil({ close: event.target.value as PencilCloseMode })
            }
            aria-label="When a stroke becomes a closed path"
          >
            <option value="never">Never</option>
            <option value="auto">Near start</option>
            <option value="always">Always</option>
          </select>
        </label>
      </div>
    </Section>
  );
}
