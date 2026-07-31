import { usePencil } from "../../../store/pencilStore";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import "../../Panel.css";
import Section from "../Section";

/** Tool options for the Pencil (freehand) tool. Shown while it is active. */
export default function PencilSection() {
  const { smoothing, setPencil } = usePencil();

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
            onChange={(v) => setPencil({ smoothing: v / 100 })}
            aria-label="Smoothing percent"
          />
        </label>
      </div>
    </Section>
  );
}
