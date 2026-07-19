import { shapeBounds, worldShapeBounds } from "../../../model/bounds";
import {
  effectiveRectCornerRadius,
  maxRectCornerRadius,
} from "../../../model/roundedRect";
import type { Shape } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ScrubbableNumber from "../../ScrubbableNumber";

export default function Geometry({ shape }: { shape: Shape }) {
  const setShapeGeometry = useEditor(
    (state) => state.setShapeGeometry
  );
  const setRectCornerRadius = useEditor(
    (state) => state.setRectCornerRadius
  );
  const doc = useEditor((state) => state.doc);
  // Parametric shapes keep placement (position/scale) in their transform, so
  // their panel fields report world bounds — setShapeGeometry maps edits back
  // onto the transform rather than folding into the generated geometry.
  const bounds = shape.generator
    ? worldShapeBounds(doc, shape)
    : shapeBounds(shape);
  const lockRatio =
    shape.type === "image" && shape.lockAspect && bounds.height > 0
      ? bounds.width / bounds.height
      : null;

  const field = (
    key: "x" | "y" | "width" | "height",
    label: string
  ) => (
    <label className="geo-field">
      <span>{label}</span>
      <ScrubbableNumber
        value={Math.round(bounds[key])}
        aria-label={label}
        onChange={(next) => {
          const patch: Partial<
            Record<"x" | "y" | "width" | "height", number>
          > = { [key]: next };
          if (lockRatio && key === "width") {
            patch.height = next / lockRatio;
          } else if (lockRatio && key === "height") {
            patch.width = next * lockRatio;
          }
          setShapeGeometry(shape.id, patch);
        }}
      />
    </label>
  );

  const radiusField = () => {
    if (shape.type !== "rect") return null;
    const radius = Math.round(effectiveRectCornerRadius(shape));
    return (
      <label className="geo-field">
        <span>R</span>
        <ScrubbableNumber
          min={0}
          max={maxRectCornerRadius(shape)}
          step={1}
          value={radius}
          aria-label="Corner radius"
          onChange={(value) =>
            setRectCornerRadius(shape.id, value)
          }
        />
      </label>
    );
  };

  return (
    <div className="geometry-grid">
      {field("x", "X")}
      {field("y", "Y")}
      {shape.type !== "text" && field("width", "W")}
      {shape.type !== "text" && field("height", "H")}
      {radiusField()}
    </div>
  );
}
