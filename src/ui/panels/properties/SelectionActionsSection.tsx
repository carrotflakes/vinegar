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
import { nodeWorldBounds } from "@/model/geometry/bounds";
import {
  canMakeClippingMaskSelection,
  canReleaseClippingMaskSelection,
} from "../../../model/clippingMask";
import {
  canMakeCompoundPathSelection,
  canReleaseCompoundPathSelection,
} from "@/model/path/compoundPath";
import {
  canGroupSelection,
  selectionUnits,
} from "../../../model/groups";
import type {
  Document,
  Group,
  Shape,
} from "../../../model/types";
import {
  commandEnabled,
  getCommand,
  runCommand,
} from "../../../commands/registry";
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
  const setClosedSelected = useEditor(
    (state) => state.setClosedSelected
  );
  const makeCompoundPathSelected = useEditor(
    (state) => state.makeCompoundPathSelected
  );
  const releaseCompoundPathSelected = useEditor(
    (state) => state.releaseCompoundPathSelected
  );

  // Path / boolean / convert / outline actions are registry commands: read
  // their live enabled state and run them by id so enablement has a single
  // source of truth (shared with the context menu and command palette).
  const can = (id: string) => {
    const cmd = getCommand(id);
    return cmd ? commandEnabled(cmd) : false;
  };

  const hasSelection = rootIds.length > 0;
  const alignableCount = rootIds.filter(
    (id) => nodeWorldBounds(doc, id) !== null
  ).length;
  const canGroup = canGroupSelection(doc, selection);
  const canUngroup = selectionUnits(doc, selection).groups.length > 0;
  const canBoolean = can("path.union");
  const closable = selectedGroup
    ? []
    : selected.filter((shape) => shape.type === "path");
  const anyOpen = closable.some((shape) =>
    shape.subpaths.some((subpath) => !subpath.closed)
  );
  const canOutline = can("path.outlineStroke");
  const canConvertToPath = can("structure.convertToPath");
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
          {can("path.simplify") && (
            <>
              <div className="btn-row">
                <button
                  className="ghost-btn"
                  title="Reduce anchors while keeping the curve shape"
                  onClick={() => runCommand("path.simplify")}
                >
                  Simplify
                </button>
                <button
                  className="ghost-btn"
                  title="Fit smooth curves through the anchors"
                  onClick={() => runCommand("path.smooth")}
                >
                  Smooth
                </button>
              </div>
              <div className="btn-row">
                <button
                  className="ghost-btn"
                  title="Convert curves to straight segments"
                  onClick={() => runCommand("path.flatten")}
                >
                  Flatten
                </button>
                <button
                  className="ghost-btn"
                  title="Reverse the path direction"
                  onClick={() => runCommand("path.reverse")}
                >
                  Reverse
                </button>
              </div>
            </>
          )}
          {can("path.join") && (
            <div className="btn-row">
              <button
                className="ghost-btn"
                title="Connect open path ends that meet"
                onClick={() => runCommand("path.join")}
              >
                Join
              </button>
            </div>
          )}
          {canConvertToPath && (
            <div className="btn-row">
              <button
                className="ghost-btn"
                onClick={() => runCommand("structure.convertToPath")}
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
                onClick={() => runCommand("path.outlineStroke")}
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
              onClick={() => runCommand("path.union")}
            >
              Union
            </button>
            <button
              className="ghost-btn"
              onClick={() => runCommand("path.subtract")}
            >
              Subtract
            </button>
          </div>
          <div className="btn-row">
            <button
              className="ghost-btn"
              onClick={() => runCommand("path.intersect")}
            >
              Intersect
            </button>
            <button
              className="ghost-btn"
              onClick={() => runCommand("path.exclude")}
            >
              Exclude
            </button>
          </div>
          <div className="btn-row">
            <button
              className="ghost-btn"
              title="Split overlapping shapes into separate faces"
              onClick={() => runCommand("path.divide")}
            >
              Divide
            </button>
          </div>
        </div>
      )}
    </>
  );
}
