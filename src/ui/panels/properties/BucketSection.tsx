import { useBucket, BUCKET_DEFAULTS } from "../../../store/bucketStore";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import "../../Panel.css";
import Section from "../Section";

/** Tool options for the Bucket Fill tool. Shown while the tool is active. */
export default function BucketSection() {
  const { gapTolerance, strokeCenterline, setBucket } = useBucket();
  return (
    <Section id="properties.bucket" title="Bucket Fill">
      <div className="field">
        <label>Gap closing</label>
        <div className="field-row">
          <input
            type="range"
            min={0}
            max={40}
            step={0.5}
            value={gapTolerance}
            onChange={(e) => setBucket({ gapTolerance: Number(e.target.value) })}
          />
          <ScrubbableNumber
            className="num"
            min={0}
            step={0.5}
            value={gapTolerance}
            defaultValue={BUCKET_DEFAULTS.gapTolerance}
            onChange={(v) => setBucket({ gapTolerance: v })}
            aria-label="Gap closing tolerance"
          />
        </div>
      </div>
      <div className="field">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={strokeCenterline}
            onChange={(e) => setBucket({ strokeCenterline: e.target.checked })}
          />
          Fill to stroke centers
        </label>
      </div>
    </Section>
  );
}
