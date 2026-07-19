import {
  instanceWorldBounds,
  shapeBounds,
  worldShapeBounds,
} from "../../../model/bounds";
import {
  effectiveRectCornerRadius,
  maxRectCornerRadius,
} from "../../../model/roundedRect";
import { isInstance } from "../../../model/scene";
import type { Shape, SymbolInstance } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ScrubbableNumber from "../../ScrubbableNumber";

export default function Geometry({
  node,
}: {
  node: Shape | SymbolInstance;
}) {
  const setShapeGeometry = useEditor(
    (state) => state.setShapeGeometry
  );
  const setRectCornerRadius = useEditor(
    (state) => state.setRectCornerRadius
  );
  const doc = useEditor((state) => state.doc);
  // Parametric shapes and instances keep placement (position/scale) in their
  // transform, so their panel fields report world bounds — setShapeGeometry
  // maps edits back onto the transform rather than into the geometry.
  const bounds = isInstance(node)
    ? instanceWorldBounds(doc, node) ?? { x: 0, y: 0, width: 0, height: 0 }
    : node.generator
      ? worldShapeBounds(doc, node)
      : shapeBounds(node);
  const lockRatio =
    !isInstance(node) &&
    node.type === "image" &&
    node.lockAspect &&
    bounds.height > 0
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
          setShapeGeometry(node.id, patch);
        }}
      />
    </label>
  );

  const radiusField = () => {
    if (isInstance(node) || node.type !== "rect") return null;
    const radius = Math.round(effectiveRectCornerRadius(node));
    return (
      <label className="geo-field">
        <span>R</span>
        <ScrubbableNumber
          min={0}
          max={maxRectCornerRadius(node)}
          step={1}
          value={radius}
          aria-label="Corner radius"
          onChange={(value) =>
            setRectCornerRadius(node.id, value)
          }
        />
      </label>
    );
  };

  const isText = !isInstance(node) && node.type === "text";
  return (
    <div className="geometry-grid">
      {field("x", "X")}
      {field("y", "Y")}
      {!isText && field("width", "W")}
      {!isText && field("height", "H")}
      {radiusField()}
    </div>
  );
}
