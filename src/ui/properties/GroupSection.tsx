import { getSelectionFrame } from "../../canvas/frame";
import { clippingMask } from "../../model/clippingMask";
import {
  applyMatrix,
  applyWorldTransformToNode,
  matrixAngle,
  nodeWorldMatrix,
  rotationAbout,
} from "../../model/matrix";
import {
  BLEND_MODES,
  type BlendMode,
  type Document,
  type Group,
  type Shape,
} from "../../model/types";
import { useEditor } from "../../store/editorStore";
import ScrubbableNumber from "../ScrubbableNumber";

function blendLabel(mode: BlendMode): string {
  const words = mode.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function GroupSection({
  doc,
  group,
  selected,
}: {
  doc: Document;
  group: Group;
  selected: Shape[];
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
      <div className="field">
        <label>Group opacity</label>
        <div className="field-row">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={group.opacity ?? 1}
            onChange={(event) =>
              updateGroupStyle(group.id, {
                opacity: Number(event.target.value),
              })
            }
          />
          <span className="num readout">
            {Math.round((group.opacity ?? 1) * 100)}%
          </span>
        </div>
      </div>
      <div className="field">
        <label>Group rotation</label>
        <div className="field-row">
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={rotationDeg}
            onChange={(event) =>
              setRotation(Number(event.target.value))
            }
          />
          <ScrubbableNumber
            className="num"
            step={1}
            value={rotationDeg}
            onChange={setRotation}
            aria-label="Group rotation"
          />
        </div>
        <button
          className="ghost-btn"
          disabled={group.transformOrigin === null}
          onClick={() =>
            updateGroupStyle(group.id, { transformOrigin: null })
          }
        >
          Reset rotation center
        </button>
      </div>
      <div className="field">
        <label>Group blend mode</label>
        <select
          className="blend-select"
          value={group.blendMode ?? "normal"}
          onChange={(event) => {
            const value = event.target.value as BlendMode;
            updateGroupStyle(group.id, {
              blendMode: value === "normal" ? undefined : value,
            });
          }}
        >
          {BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {blendLabel(mode)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
