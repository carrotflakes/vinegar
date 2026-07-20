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
import BrushPanel, { EraserPanel } from "./BrushPanel";
import BucketPanel from "./BucketPanel";
import ArtboardPanel from "./ArtboardPanel";
import AppearanceSection from "./AppearanceSection";
import EffectsSection from "./EffectsSection";
import GeneratorSection from "./GeneratorSection";
import GroupSection from "./GroupSection";
import SelectionActionsSection from "./SelectionActionsSection";
import ImageSection from "./ImageSection";
import TextSection from "./TextSection";
import SymbolInstanceSection from "./SymbolInstanceSection";
import TransformSection from "./TransformSection";
import "../../Panel.css";
import "./PropertiesPanel.css";

export default function PropertiesPanel() {
  const doc = useEditor((state) => state.doc);
  const tool = useEditor((state) => state.tool);
  const selection = useEditor((state) => state.selection);
  const selectionPivot = useEditor((state) => state.selectionPivot);
  const setSelectionPivot = useEditor(
    (state) => state.setSelectionPivot
  );
  const selectedArtboardId = useEditor(
    (state) => state.selectedArtboardId
  );

  const artboard = selectedArtboardId
    ? doc.artboards.find((candidate) =>
        candidate.id === selectedArtboardId
      ) ?? null
    : null;
  if (artboard) return <ArtboardPanel artboard={artboard} />;

  const rootIds = selectionRoots(doc, selection);
  const selectedNode =
    rootIds.length === 1 ? doc.nodes[rootIds[0]] : undefined;
  const selectedInstance =
    isInstance(selectedNode)
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
      {tool === "brush" && <BrushPanel />}
      {tool === "eraser" && <EraserPanel />}
      {tool === "bucket" && <BucketPanel />}

      {selectedInstance && (
        <SymbolInstanceSection
          instance={selectedInstance}
          symbolName={
            doc.symbols[selectedInstance.symbolId]?.name ??
            "Missing symbol"
          }
        />
      )}

      {showAppearance && (
        <AppearanceSection selected={selected} />
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

      {selectedGroup && (
        <GroupSection
          doc={doc}
          group={selectedGroup}
          selected={selectedGroupLeaves}
        />
      )}

      {transformLeaf && <TransformSection node={transformLeaf} />}

      {rootIds.length > 1 && selectionPivot && (
        <div className="panel-section">
          <div className="panel-title">Transform</div>
          <button
            className="ghost-btn"
            onClick={() => setSelectionPivot(null)}
          >
            Reset rotation center
          </button>
        </div>
      )}

      {selectedNode && <EffectsSection node={selectedNode} />}

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
