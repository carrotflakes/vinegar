import { useBucket } from "../../../store/bucketStore";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import "../../Panel.css";

/** Tool options for the Bucket Fill tool. Shown while the tool is active. */
export default function BucketPanel() {
  const { gapTolerance, strokeCenterline, setBucket } = useBucket();
  return (
    <div className="panel-section">
      <div className="panel-title">Bucket Fill</div>
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
    </div>
  );
}
