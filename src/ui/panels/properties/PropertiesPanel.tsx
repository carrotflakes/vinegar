import {
  exactlySelectedGroup,
} from "../../../model/groups";
import {
  descendantShapeIds,
  isInstance,
  isShape,
  selectionRoots,
} from "../../../model/scene";
import type {
  SceneNode,
  Shape,
  SymbolInstance,
} from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import BrushPanel, { EraserPanel } from "./BrushPanel";
import ArtboardPanel from "./ArtboardPanel";
import AppearanceSection from "./AppearanceSection";
import EffectsSection from "./EffectsSection";
import GroupSection from "./GroupSection";
import SelectionActionsSection from "./SelectionActionsSection";
import {
  ImageSection,
  TextSection,
} from "./ShapeSections";
import SymbolInstanceSection from "./SymbolInstanceSection";
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
  const selectedInstance =
    rootIds.length === 1 && isInstance(doc.nodes[rootIds[0]])
      ? (doc.nodes[rootIds[0]] as SymbolInstance)
      : null;
  const selectedIds = rootIds.flatMap((id) =>
    isShape(doc.nodes[id]) ? [id] : descendantShapeIds(doc, id)
  );
  const selected = selectedIds
    .map((id) => doc.nodes[id])
    .filter(isShape) as Shape[];
  const selectedGroup = exactlySelectedGroup(doc, selection);
  const effectTarget: SceneNode | null =
    selectedInstance ??
    selectedGroup ??
    (selected.length === 1 ? selected[0] : null);

  return (
    <div className="panel">
      {tool === "brush" && <BrushPanel />}
      {tool === "eraser" && <EraserPanel />}

      {selectedInstance && (
        <SymbolInstanceSection
          instance={selectedInstance}
          symbolName={
            doc.symbols[selectedInstance.symbolId]?.name ??
            "Missing symbol"
          }
        />
      )}

      <AppearanceSection
        doc={doc}
        selected={selected}
        selectedGroup={selectedGroup}
      />

      {selected.length === 1 && selected[0].type === "image" && (
        <ImageSection
          shape={selected[0]}
          asset={doc.assets[selected[0].assetId] ?? null}
        />
      )}

      {selected.length === 1 && selected[0].type === "text" && (
        <TextSection shape={selected[0]} />
      )}

      {selectedGroup && (
        <GroupSection
          doc={doc}
          group={selectedGroup}
          selected={selected}
        />
      )}

      {selected.length > 1 && !selectedGroup && selectionPivot && (
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

      {effectTarget && <EffectsSection node={effectTarget} />}

      <SelectionActionsSection
        doc={doc}
        selection={selection}
        selected={selected}
        selectedGroup={selectedGroup}
      />
    </div>
  );
}
