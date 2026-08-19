import { effectiveAnchorType } from "@/model/path/anchorType";
import { isShape } from "@/model/scene";
import type { AnchorType } from "@/model/types";
import { useEditor } from "@/store/editorStore";
import { groupEditNodesByShape } from "@/store/state";
import SegmentedControl, {
  type SegmentedControlOption,
} from "@/ui/controls/SegmentedControl";
import "../../Panel.css";
import Section from "../Section";

// Linkage only: "Cusp" unlinks the handles but keeps them, unlike the node
// tool's double-click, which strips them back to a handle-less corner.
const TYPES: SegmentedControlOption<AnchorType>[] = [
  { value: "cusp", label: "Cusp", title: "Handles move independently (kept in place)" },
  { value: "smooth", label: "Smooth", title: "The opposite handle rotates, keeping its length" },
  { value: "symmetric", label: "Symmetric", title: "The opposite handle mirrors angle and length" },
];

/** Handle linkage for the anchors currently selected with the node tool. */
export default function NodeTypeSection() {
  const doc = useEditor((state) => state.doc);
  const editNodes = useEditor((state) => state.editNodes);
  const setEditNodeType = useEditor((state) => state.setEditNodeType);

  const types: AnchorType[] = [];
  for (const [shapeId, targets] of groupEditNodesByShape(editNodes)) {
    const shape = doc.nodes[shapeId];
    if (!isShape(shape)) continue;
    for (const { sub, index } of targets) {
      const anchor = shape.type === "path"
        ? shape.subpaths[sub]?.anchors[index]
        : shape.type === "brush" && sub === 0
          ? shape.anchors[index]
          : null;
      if (anchor) types.push(effectiveAnchorType(anchor));
    }
  }
  if (types.length === 0) return null;

  const active = types.every((type) => type === types[0]) ? types[0] : null;

  return (
    <Section id="properties.nodeType" title="Node type">
      <SegmentedControl
        value={active}
        options={TYPES}
        onChange={setEditNodeType}
        ariaLabel="Node type"
      />
      <span className="readout">
        {active ?? "Mixed"} · {types.length === 1 ? "1 node" : `${types.length} nodes`}
      </span>
    </Section>
  );
}
