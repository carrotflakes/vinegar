import {
  getSelectionFrame,
  type SelectionLeaf,
} from "../../../canvas/frame";
import { clippingMask } from "../../../model/clippingMask";
import {
  applyMatrix,
  applyWorldTransformToNode,
  matrixRotationAngle,
  nodeWorldMatrix,
  rotationAbout,
} from "@/model/geometry/matrix";
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
import Section from "../Section";
import { TransformFlipControls } from "./TransformSection";

interface GroupSectionProps {
  doc: Document;
  group: Group;
  selected: SelectionLeaf[];
}

/**
 * Rotation of a whole group, about the group's own pivot. Groups have no
 * position/size fields of their own, so this is the group's Transform section.
 */
export function GroupTransformSection({
  doc,
  group,
  selected,
}: GroupSectionProps) {
  const updateNodeStyle = useEditor((state) => state.updateNodeStyle);
  const rotationDeg = Math.round(
    (matrixRotationAngle(nodeWorldMatrix(doc, group.id)) * 180) / Math.PI
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
    const delta = target - matrixRotationAngle(world);
    updateNodeStyle(group.id, {
      transform: applyWorldTransformToNode(
        doc,
        group,
        rotationAbout(pivot, delta)
      ).transform,
    });
  };

  return (
    <Section id="properties.transform" title="Transform">
      <RotationField
        label="Rotation"
        degrees={rotationDeg}
        onChange={setRotation}
        resetDisabled={group.transformOrigin === null}
        onReset={() =>
          updateNodeStyle(group.id, { transformOrigin: null })
        }
      />
      <TransformFlipControls />
    </Section>
  );
}

/** Opacity and blending applied to the group as a composited whole. */
export default function GroupSection({ group }: { group: Group }) {
  const updateNodeStyle = useEditor((state) => state.updateNodeStyle);
  return (
    <Section id="properties.appearance" title="Appearance">
      <OpacityField
        label="Opacity"
        value={group.opacity}
        onChange={(value) =>
          updateNodeStyle(group.id, { opacity: value })
        }
      />
      <BlendModeField
        label="Blend mode"
        value={group.blendMode}
        onChange={(value) =>
          updateNodeStyle(group.id, { blendMode: value })
        }
      />
    </Section>
  );
}
