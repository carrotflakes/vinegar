import { leafLocalBounds } from "@/model/geometry/bounds";
import {
  applyMatrix,
  applyWorldTransformToNode,
  matrixAngle,
  nodeWorldMatrix,
  rotationAbout,
} from "@/model/geometry/matrix";
import { isInstance } from "../../../model/scene";
import type { Shape, SymbolInstance } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import Geometry from "./Geometry";
import { RotationField } from "./StyleFields";

/**
 * Position, size and rotation for a single leaf node (shape or symbol
 * instance). Rotation is computed in world space so the node spins about its
 * own pivot regardless of parent transforms.
 */
export default function TransformSection({
  node,
}: {
  node: Shape | SymbolInstance;
}) {
  const doc = useEditor((state) => state.doc);
  const updateSelectedStyle = useEditor(
    (state) => state.updateSelectedStyle
  );
  const updateNodeStyle = useEditor((state) => state.updateNodeStyle);

  const world = nodeWorldMatrix(doc, node.id);
  const rotationDeg = Math.round((matrixAngle(world) * 180) / Math.PI);

  // Shapes fold into the multi-shape style action; instances patch their own
  // BaseNode fields (updateSelectedStyle only touches shapes).
  const patchTransform = (transform: Shape["transform"]) =>
    isInstance(node)
      ? updateNodeStyle(node.id, { transform })
      : updateSelectedStyle({ transform });
  const resetPivot = () =>
    isInstance(node)
      ? updateNodeStyle(node.id, { transformOrigin: null })
      : updateSelectedStyle({ transformOrigin: null });

  const setRotation = (degrees: number) => {
    const bounds = leafLocalBounds(doc, node);
    const localOrigin = node.transformOrigin ?? {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    const pivot = applyMatrix(world, localOrigin);
    const target = (degrees * Math.PI) / 180;
    const delta = target - matrixAngle(world);
    patchTransform(
      applyWorldTransformToNode(doc, node, rotationAbout(pivot, delta))
        .transform
    );
  };

  return (
    <div className="panel-section">
      <div className="panel-title">Transform</div>
      <Geometry node={node} />
      <RotationField
        label="Rotation"
        degrees={rotationDeg}
        onChange={setRotation}
        resetDisabled={node.transformOrigin === null}
        onReset={resetPivot}
      />
    </div>
  );
}
