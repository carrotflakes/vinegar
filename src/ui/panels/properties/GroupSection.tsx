import {
  getSelectionFrame,
  type SelectionLeaf,
} from "../../../canvas/frame";
import { clippingMask } from "../../../model/clippingMask";
import {
  applyMatrix,
  applyWorldTransformToNode,
  matrixAngle,
  nodeWorldMatrix,
  rotationAbout,
} from "../../../model/matrix";
import {
  type Document,
  type Group,
} from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import {
  BlendModeField,
  OpacityField,
  RotationField,
} from "./StyleFields";

export default function GroupSection({
  doc,
  group,
  selected,
}: {
  doc: Document;
  group: Group;
  selected: SelectionLeaf[];
}) {
  const updateGroupStyle = useEditor((state) => state.updateGroupStyle);
  const rotationDeg = Math.round(
    (matrixAngle(nodeWorldMatrix(doc, group.id)) * 180) / Math.PI
  );
  const setRotation = (degrees: number) => {
    const mask = clippingMask(doc, group);
    const frame = getSelectionFrame(
      doc,
      mask ? [mask] : selected,
      group
    );
    if (!frame) return;
    const localCenter = group.transformOrigin ?? {
      x: frame.bounds.x + frame.bounds.width / 2,
      y: frame.bounds.y + frame.bounds.height / 2,
    };
    const world = nodeWorldMatrix(doc, group.id);
    const pivot = applyMatrix(world, localCenter);
    const target = (degrees * Math.PI) / 180;
    const delta = target - matrixAngle(world);
    updateGroupStyle(group.id, {
      transform: applyWorldTransformToNode(
        doc,
        group,
        rotationAbout(pivot, delta)
      ).transform,
    });
  };

  return (
    <div className="panel-section">
      <div className="panel-title">Group “{group.name}”</div>
      <OpacityField
        label="Group opacity"
        value={group.opacity}
        onChange={(value) =>
          updateGroupStyle(group.id, { opacity: value })
        }
      />
      <RotationField
        label="Group rotation"
        degrees={rotationDeg}
        onChange={setRotation}
        resetDisabled={group.transformOrigin === null}
        onReset={() =>
          updateGroupStyle(group.id, { transformOrigin: null })
        }
      />
      <BlendModeField
        label="Group blend mode"
        value={group.blendMode}
        onChange={(value) =>
          updateGroupStyle(group.id, { blendMode: value })
        }
      />
    </div>
  );
}
