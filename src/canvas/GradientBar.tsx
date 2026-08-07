import {
  type GradientKind,
  isGradientPaint,
  removeStop,
  reverseStops,
  sortedStops,
  updateStop,
  withGradientKind,
} from "@/model/gradient";
import { shapeBounds } from "@/model/geometry/bounds";
import { useEditor } from "../store/editorStore";
import { useGradientTool } from "../store/gradientToolStore";
import ColorInput from "@/ui/controls/ColorInput";
import { gradientTargetShape } from "./gradientHandles";
import "./GradientBar.css";

const KINDS: { id: GradientKind; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "radial", label: "Radial" },
  { id: "conic", label: "Conic" },
];

/**
 * The gradient tool's own controls: which paint it edits, the ramp's kind, and
 * the colour of the stop the annotator has selected. Everything here is also
 * in the colour popover — this is the copy that is within reach while both
 * hands are on the canvas, the way `PenDraftBar` is for the pen.
 */
export default function GradientBar() {
  const tool = useEditor((s) => s.tool);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const updateSelectedStyle = useEditor((s) => s.updateSelectedStyle);
  const target = useGradientTool((s) => s.target);
  const setTarget = useGradientTool((s) => s.setTarget);
  const stopId = useGradientTool((s) => s.stopId);
  const setStopId = useGradientTool((s) => s.setStopId);

  if (tool !== "gradient") return null;

  const shape = gradientTargetShape(doc, selection);
  const paint = shape ? shape[target] : null;
  const gradient = isGradientPaint(paint) ? paint : null;
  const stops = gradient ? sortedStops(gradient.stops) : [];
  const stop = stops.find((s) => s.id === stopId) ?? stops[0] ?? null;
  const apply = (next: NonNullable<typeof gradient>) =>
    updateSelectedStyle({ [target]: next });

  // Never take focus: a focused button would swallow the canvas shortcuts.
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <div
      className="gradient-tool-bar"
      role="group"
      aria-label="Gradient"
      onKeyDown={(e) => e.stopPropagation()}
    >
      {(["fill", "stroke"] as const).map((t) => (
        <button
          key={t}
          className={"gradient-tool-btn" + (target === t ? " active" : "")}
          title={`Edit the ${t} gradient`}
          onPointerDown={keepFocus}
          onClick={() => setTarget(t)}
        >
          {t === "fill" ? "Fill" : "Stroke"}
        </button>
      ))}

      <span className="gradient-tool-sep" />

      {KINDS.map((k) => (
        <button
          key={k.id}
          className={
            "gradient-tool-btn" + (gradient?.kind === k.id ? " active" : "")
          }
          disabled={!gradient}
          title={`${k.label} gradient`}
          onPointerDown={keepFocus}
          onClick={() =>
            gradient && shape && apply(withGradientKind(gradient, k.id, shapeBounds(shape, doc)))
          }
        >
          {k.label}
        </button>
      ))}

      {gradient && stop && (
        <>
          <span className="gradient-tool-sep" />
          <ColorInput
            className="gradient-tool-color"
            value={stop.color}
            onChange={(color) => apply(updateStop(gradient, stop.id, { color }))}
            alpha={stop.alpha}
            onAlphaChange={(alpha) => apply(updateStop(gradient, stop.id, { alpha }))}
            title="Selected stop color"
          />
          <button
            className="gradient-tool-btn"
            title="Remove the selected stop"
            disabled={stops.length <= 2}
            onPointerDown={keepFocus}
            onClick={() => {
              apply(removeStop(gradient, stop.id));
              setStopId(null);
            }}
          >
            −
          </button>
          <button
            className="gradient-tool-btn"
            title="Reverse the ramp"
            onPointerDown={keepFocus}
            onClick={() => apply(reverseStops(gradient))}
          >
            ⇄
          </button>
        </>
      )}

      {!gradient && (
        <span className="gradient-tool-hint">
          {shape ? "Drag across the shape" : "Select a shape"}
        </span>
      )}
    </div>
  );
}
