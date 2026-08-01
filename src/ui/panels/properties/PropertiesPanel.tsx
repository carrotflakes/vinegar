import {
  exactlySelectedGroup,
} from "../../../model/groups";
import {
  descendantNodeIds,
  isInstance,
  isShape,
  selectionRoots,
} from "../../../model/scene";
import type { SelectionLeaf } from "../../../canvas/frame";
import { useEditor } from "../../../store/editorStore";
import BrushSection, { EraserSection } from "./BrushSection";
import PencilSection from "./PencilSection";
import BucketSection from "./BucketSection";
import FrameSection from "./FrameSection";
import AppearanceSection from "./AppearanceSection";
import EffectsSection from "./EffectsSection";
import GeneratorSection from "./GeneratorSection";
import ModifiersSection from "./ModifiersSection";
import GroupSection, { GroupTransformSection } from "./GroupSection";
import SelectionActionsSection from "./SelectionActionsSection";
import SelectionHeader from "./SelectionHeader";
import ImageSection from "./ImageSection";
import NodeTypeSection from "./NodeTypeSection";
import NodeWidthSection from "./NodeWidthSection";
import TextSection from "./TextSection";
import SymbolInstanceSection from "./SymbolInstanceSection";
import TransformSection, {
  SelectionTransformSection,
} from "./TransformSection";
import "../../Panel.css";
import "./PropertiesPanel.css";

/**
 * Sections run identity → transform → appearance → node-specific → effects →
 * actions, so a given property sits at the same depth whatever is selected.
 * Each section titles its own topic only; *what* is selected is stated once,
 * by the header.
 */
export default function PropertiesPanel() {
  const doc = useEditor((state) => state.doc);
  const tool = useEditor((state) => state.tool);
  const selection = useEditor((state) => state.selection);
  const selectionPivot = useEditor((state) => state.selectionPivot);

  const rootIds = selectionRoots(doc, selection);
  const selectedNode =
    rootIds.length === 1 ? doc.nodes[rootIds[0]] : undefined;
  const selectedFrame =
    selectedNode?.type === "frame" ? selectedNode : null;
  const selectedInstance = isInstance(selectedNode)
    ? selectedNode
    : null;
  const selected = rootIds
    .map((id) => doc.nodes[id])
    .filter(isShape);
  const selectedGroup = exactlySelectedGroup(doc, selection);
  const selectedGroupLeaves = selectedGroup
    ? descendantNodeIds(doc, selectedGroup.id)
        .map((id) => doc.nodes[id])
        .filter(
          (node): node is SelectionLeaf =>
            isShape(node) || isInstance(node)
        )
    : [];
  const showAppearance =
    rootIds.length === 0 || selected.length === rootIds.length;
  // A single leaf (shape or symbol instance) gets a Transform section with its
  // world position, size and rotation.
  const transformLeaf =
    selectedInstance ??
    (rootIds.length === 1 && selected.length === 1 ? selected[0] : null);
  return (
    <div className="panel">
      {tool === "brush" && <BrushSection />}
      {tool === "pencil" && <PencilSection />}
      {tool === "eraser" && <EraserSection />}
      {tool === "bucket" && <BucketSection />}
      {tool === "node" && <NodeTypeSection />}
      {tool === "node" && <NodeWidthSection />}

      <SelectionHeader doc={doc} rootIds={rootIds} />

      {selectedFrame && <FrameSection frame={selectedFrame} />}

      {transformLeaf && <TransformSection node={transformLeaf} />}

      {selectedGroup && (
        <GroupTransformSection
          doc={doc}
          group={selectedGroup}
          selected={selectedGroupLeaves}
        />
      )}

      {rootIds.length > 1 &&
        rootIds.every((id) => doc.nodes[id]?.type !== "frame") && (
          <SelectionTransformSection
            canResetPivot={selectionPivot !== null}
          />
        )}

      {showAppearance && <AppearanceSection selected={selected} />}

      {selectedGroup && <GroupSection group={selectedGroup} />}

      {selectedInstance && (
        <SymbolInstanceSection
          instance={selectedInstance}
          symbolName={
            doc.symbols[selectedInstance.symbolId]?.name ??
            "Missing symbol"
          }
        />
      )}

      {selected.length === 1 && selected[0].type === "image" && (
        <ImageSection
          shape={selected[0]}
          asset={doc.assets[selected[0].assetId] ?? null}
        />
      )}

      {selected.length === 1 && selected[0].type === "text" && (
        <TextSection shape={selected[0]} />
      )}

      {selected.length === 1 &&
        selected[0].type === "path" &&
        selected[0].generator && (
          <GeneratorSection shape={selected[0]} />
        )}

      {selected.length === 1 && selected[0].type === "path" && (
        <ModifiersSection shape={selected[0]} />
      )}

      {/* Effects on a frame would have to composite the whole board; frames
          stay out until that is designed. */}
      {selectedNode && !selectedFrame && (
        <EffectsSection node={selectedNode} />
      )}

      <SelectionActionsSection
        doc={doc}
        selection={selection}
        rootIds={rootIds}
        selected={selected}
        selectedGroup={selectedGroup}
      />
    </div>
  );
}
