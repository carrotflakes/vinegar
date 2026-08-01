import { leafLocalBounds } from "@/model/geometry/bounds";
import { LuFlipHorizontal2, LuFlipVertical2 } from "react-icons/lu";
import {
  applyMatrix,
  applyWorldTransformToNode,
  matrixRotationAngle,
  nodeWorldMatrix,
  rotationAbout,
} from "@/model/geometry/matrix";
import { isInstance } from "../../../model/scene";
import type { Shape, SymbolInstance } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import {
  commandEnabled,
  getCommand,
  runCommand,
} from "../../../commands/registry";
import Geometry from "./Geometry";
import { RotationField } from "./StyleFields";
import Section from "../Section";

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
  const rotationDeg = Math.round(
    (matrixRotationAngle(world) * 180) / Math.PI
  );

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
    const delta = target - matrixRotationAngle(world);
    patchTransform(
      applyWorldTransformToNode(doc, node, rotationAbout(pivot, delta))
        .transform
    );
  };

  return (
    <Section title="Transform">
      <Geometry node={node} />
      <RotationField
        label="Rotation"
        degrees={rotationDeg}
        onChange={setRotation}
        resetDisabled={node.transformOrigin === null}
        onReset={resetPivot}
      />
      <TransformFlipControls />
    </Section>
  );
}

/** Stateless transform commands; the matrix itself remains the source of truth. */
export function TransformFlipControls() {
  const horizontal = getCommand("structure.flipHorizontal");
  const vertical = getCommand("structure.flipVertical");
  return (
    <div className="btn-row" role="group" aria-label="Flip selection">
      <button
        className="ghost-btn align-btn"
        title="Flip horizontally (Shift+H)"
        aria-label="Flip horizontally"
        disabled={!horizontal || !commandEnabled(horizontal)}
        onClick={() => runCommand("structure.flipHorizontal")}
      >
        <LuFlipHorizontal2 aria-hidden />
      </button>
      <button
        className="ghost-btn align-btn"
        title="Flip vertically (Shift+V)"
        aria-label="Flip vertically"
        disabled={!vertical || !commandEnabled(vertical)}
        onClick={() => runCommand("structure.flipVertical")}
      >
        <LuFlipVertical2 aria-hidden />
      </button>
    </div>
  );
}

/**
 * Transform section for a multi-node selection: there is no single position or
 * size to show, only the shared rotation centre the canvas is using.
 */
export function SelectionTransformSection({
  canResetPivot,
}: {
  canResetPivot: boolean;
}) {
  const setSelectionPivot = useEditor(
    (state) => state.setSelectionPivot
  );
  return (
    <Section title="Transform">
      <TransformFlipControls />
      {canResetPivot && (
        <button
          className="ghost-btn"
          onClick={() => setSelectionPivot(null)}
        >
          Reset rotation center
        </button>
      )}
    </Section>
  );
}
