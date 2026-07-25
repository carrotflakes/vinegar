import { MAX_ANCHOR_WIDTH } from "@/model/brush/brushWidth";
import { isShape } from "@/model/scene";
import type { BrushShape } from "@/model/types";
import { useEditor } from "@/store/editorStore";
import { groupEditNodesByShape } from "@/store/state";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import "../../Panel.css";

/**
 * Width of the brush anchors selected with the node tool, in document units.
 * The canvas knobs are the fast way to shape a stroke; this is the precise one.
 * Scoped to a single brush so absolute width ↔ the anchor's `w` multiplier is
 * an unambiguous conversion (`w * strokeWidth`).
 */
export default function NodeWidthSection() {
  const doc = useEditor((state) => state.doc);
  const editNodes = useEditor((state) => state.editNodes);
  const setEditNodeWidths = useEditor((state) => state.setEditNodeWidths);

  const byShape = groupEditNodesByShape(editNodes);
  if (byShape.size !== 1) return null;
  const [shapeId, targets] = [...byShape][0];
  const shape = doc.nodes[shapeId];
  if (!isShape(shape) || shape.type !== "brush") return null;

  const widths = anchorWidths(shape, targets);
  if (widths.length === 0) return null;

  const base = shape.strokeWidth;
  const mixed = widths.some((w) => Math.abs(w - widths[0]) > 1e-6);
  const average = widths.reduce((sum, w) => sum + w, 0) / widths.length;
  const shown = Number((average * base).toFixed(2));

  return (
    <div className="panel-section">
      <div className="panel-title">Node width</div>

      <div className="field">
        <label>Width</label>
        <div className="field-row">
          <ScrubbableNumber
            className="num"
            min={0}
            max={MAX_ANCHOR_WIDTH * base}
            step={0.1}
            value={shown}
            onChange={(v) => setEditNodeWidths({ width: v / Math.max(1e-6, base) })}
            aria-label="Node width"
          />
          <span className="readout">
            {mixed ? "Mixed · " : ""}
            {widths.length === 1 ? "1 node" : `${widths.length} nodes`}
          </span>
        </div>
      </div>

      <div className="field-row">
        {/* Ratio steps keep a taper intact, which typing one width cannot. */}
        <button
          className="ghost-btn"
          onClick={() => setEditNodeWidths({ factor: 1 / 1.2 })}
        >
          Thinner
        </button>
        <button
          className="ghost-btn"
          onClick={() => setEditNodeWidths({ factor: 1.2 })}
        >
          Thicker
        </button>
      </div>
    </div>
  );
}

function anchorWidths(
  shape: BrushShape,
  targets: readonly { sub: number; index: number }[]
): number[] {
  const seen = new Set<number>();
  const widths: number[] = [];
  for (const { sub, index } of targets) {
    if (sub !== 0 || seen.has(index)) continue;
    const anchor = shape.anchors[index];
    if (!anchor) continue;
    seen.add(index);
    widths.push(anchor.w);
  }
  return widths;
}
