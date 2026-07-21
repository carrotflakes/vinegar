import {
  LuAlignCenterHorizontal,
  LuAlignCenterVertical,
  LuAlignEndHorizontal,
  LuAlignEndVertical,
  LuAlignHorizontalDistributeCenter,
  LuAlignStartHorizontal,
  LuAlignStartVertical,
  LuAlignVerticalDistributeCenter,
} from "react-icons/lu";
import { nodeWorldBounds } from "../../../model/bounds";
import { isAreal } from "../../../model/boolean";
import {
  canMakeClippingMaskSelection,
  canReleaseClippingMaskSelection,
} from "../../../model/clippingMask";
import {
  canMakeCompoundPathSelection,
  canReleaseCompoundPathSelection,
} from "../../../model/compoundPath";
import { canConvertShapeToPath } from "../../../model/convertToPath";
import {
  canGroupSelection,
  selectionUnits,
} from "../../../model/groups";
import { parentIdOf } from "../../../model/scene";
import type {
  Document,
  Group,
  Shape,
} from "../../../model/types";
import { useEditor } from "../../../store/editorStore";

export default function SelectionActionsSection({
  doc,
  selection,
  rootIds,
  selected,
  selectedGroup,
}: {
  doc: Document;
  selection: string[];
  rootIds: string[];
  selected: Shape[];
  selectedGroup: Group | null;
}) {
  const deleteSelected = useEditor((state) => state.deleteSelected);
  const bringToFront = useEditor((state) => state.bringToFront);
  const sendToBack = useEditor((state) => state.sendToBack);
  const groupSelected = useEditor((state) => state.groupSelected);
  const ungroupSelected = useEditor((state) => state.ungroupSelected);
  const makeClippingMaskSelected = useEditor(
    (state) => state.makeClippingMaskSelected
  );
  const releaseClippingMaskSelected = useEditor(
    (state) => state.releaseClippingMaskSelected
  );
  const alignSelected = useEditor((state) => state.alignSelected);
  const distributeSelected = useEditor(
    (state) => state.distributeSelected
  );
  const duplicateSelected = useEditor(
    (state) => state.duplicateSelected
  );
  const booleanSelected = useEditor((state) => state.booleanSelected);
  const setClosedSelected = useEditor(
    (state) => state.setClosedSelected
  );
  const outlineStrokeSelected = useEditor(
    (state) => state.outlineStrokeSelected
  );
  const convertSelectedToPaths = useEditor(
    (state) => state.convertSelectedToPaths
  );
  const makeCompoundPathSelected = useEditor(
    (state) => state.makeCompoundPathSelected
  );
  const releaseCompoundPathSelected = useEditor(
    (state) => state.releaseCompoundPathSelected
  );

  const hasSelection = rootIds.length > 0;
  const allRootsAreShapes = selected.length === rootIds.length;
  const sameParent =
    rootIds.length > 0 &&
    new Set(rootIds.map((id) => parentIdOf(doc, id))).size === 1;
  const alignableCount = rootIds.filter(
    (id) => nodeWorldBounds(doc, id) !== null
  ).length;
  const canGroup = canGroupSelection(doc, selection);
  const canUngroup = selectionUnits(doc, selection).groups.length > 0;
  const canBoolean =
    allRootsAreShapes &&
    sameParent &&
    selected.length >= 2 &&
    selected.every(isAreal);
  const closable = selectedGroup
    ? []
    : selected.filter((shape) => shape.type === "path");
  const anyOpen = closable.some((shape) =>
    shape.subpaths.some((subpath) => !subpath.closed)
  );
  const canOutline =
    !selectedGroup &&
    selected.some(
      (shape) =>
        shape.type !== "text" &&
        shape.type !== "image" &&
        shape.stroke !== null &&
        shape.strokeWidth > 0
    );
  const canConvertToPath = rootIds.some((id) =>
    canConvertShapeToPath(doc.nodes[id])
  );
  const canMakeCompound = canMakeCompoundPathSelection(doc, selection);
  const canReleaseCompound =
    canReleaseCompoundPathSelection(doc, selection);
  const canMakeClippingMask =
    canMakeClippingMaskSelection(doc, selection);
  const canReleaseClippingMask =
    canReleaseClippingMaskSelection(doc, selection);

  return (
    <>
      {hasSelection && (
        <div className="panel-section">
          <div className="panel-title">Arrange</div>
          <div className="btn-row">
            <button className="ghost-btn" onClick={bringToFront}>
              Bring to front
            </button>
            <button className="ghost-btn" onClick={sendToBack}>
              Send to back
            </button>
          </div>
          {(canGroup || canUngroup) && (
            <div className="btn-row">
              <button
                className="ghost-btn"
                disabled={!canGroup}
                onClick={groupSelected}
              >
                Group
              </button>
              <button
                className="ghost-btn"
                disabled={!canUngroup}
                onClick={ungroupSelected}
              >
                Ungroup
              </button>
            </div>
          )}
          {(canMakeClippingMask || canReleaseClippingMask) && (
            <div className="btn-row">
              {canMakeClippingMask && (
                <button
                  className="ghost-btn"
                  onClick={makeClippingMaskSelected}
                >
                  Make clipping mask
                </button>
              )}
              {canReleaseClippingMask && (
                <button
                  className="ghost-btn"
                  onClick={releaseClippingMaskSelected}
                >
                  Release clipping mask
                </button>
              )}
            </div>
          )}
          {(canMakeCompound || canReleaseCompound) && (
            <div className="btn-row">
              {canMakeCompound && (
                <button
                  className="ghost-btn"
                  onClick={makeCompoundPathSelected}
                >
                  Make compound path
                </button>
              )}
              {canReleaseCompound && (
                <button
                  className="ghost-btn"
                  onClick={releaseCompoundPathSelected}
                >
                  Release compound path
                </button>
              )}
            </div>
          )}
          {closable.length > 0 && (
            <div className="btn-row">
              <button
                className="ghost-btn"
                onClick={() => setClosedSelected(anyOpen)}
              >
                {anyOpen ? "Close path" : "Open path"}
              </button>
            </div>
          )}
          {canConvertToPath && (
            <div className="btn-row">
              <button
                className="ghost-btn"
                onClick={convertSelectedToPaths}
              >
                Convert to path
              </button>
            </div>
          )}
          {canOutline && (
            <div className="btn-row">
              <button
                className="ghost-btn"
                title="Convert stroke to a filled path"
                onClick={outlineStrokeSelected}
              >
                Outline stroke
              </button>
            </div>
          )}
          <div className="btn-row">
            <button className="ghost-btn" onClick={duplicateSelected}>
              Duplicate
            </button>
            <button
              className="ghost-btn danger"
              onClick={deleteSelected}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {alignableCount >= 2 && (
        <div className="panel-section">
          <div className="panel-title">Align</div>
          <div className="btn-row">
            <button
              className="ghost-btn align-btn"
              title="Align left"
              onClick={() => alignSelected("left")}
            >
              <LuAlignStartVertical aria-hidden />
            </button>
            <button
              className="ghost-btn align-btn"
              title="Align horizontal centers"
              onClick={() => alignSelected("hcenter")}
            >
              <LuAlignCenterVertical aria-hidden />
            </button>
            <button
              className="ghost-btn align-btn"
              title="Align right"
              onClick={() => alignSelected("right")}
            >
              <LuAlignEndVertical aria-hidden />
            </button>
          </div>
          <div className="btn-row">
            <button
              className="ghost-btn align-btn"
              title="Align top"
              onClick={() => alignSelected("top")}
            >
              <LuAlignStartHorizontal aria-hidden />
            </button>
            <button
              className="ghost-btn align-btn"
              title="Align vertical centers"
              onClick={() => alignSelected("vmiddle")}
            >
              <LuAlignCenterHorizontal aria-hidden />
            </button>
            <button
              className="ghost-btn align-btn"
              title="Align bottom"
              onClick={() => alignSelected("bottom")}
            >
              <LuAlignEndHorizontal aria-hidden />
            </button>
          </div>
          <div className="btn-row">
            <button
              className="ghost-btn"
              disabled={alignableCount < 3}
              title="Distribute horizontally"
              onClick={() => distributeSelected("h")}
            >
              <LuAlignHorizontalDistributeCenter aria-hidden />
              <span>Dist H</span>
            </button>
            <button
              className="ghost-btn"
              disabled={alignableCount < 3}
              title="Distribute vertically"
              onClick={() => distributeSelected("v")}
            >
              <LuAlignVerticalDistributeCenter aria-hidden />
              <span>Dist V</span>
            </button>
          </div>
        </div>
      )}

      {canBoolean && (
        <div className="panel-section">
          <div className="panel-title">Boolean</div>
          <div className="btn-row">
            <button
              className="ghost-btn"
              onClick={() => booleanSelected("union")}
            >
              Union
            </button>
            <button
              className="ghost-btn"
              onClick={() => booleanSelected("subtract")}
            >
              Subtract
            </button>
          </div>
          <div className="btn-row">
            <button
              className="ghost-btn"
              onClick={() => booleanSelected("intersect")}
            >
              Intersect
            </button>
            <button
              className="ghost-btn"
              onClick={() => booleanSelected("xor")}
            >
              Exclude
            </button>
          </div>
        </div>
      )}
    </>
  );
}
