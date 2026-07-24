import { unionNodeWorldBounds } from "@/model/geometry/bounds";
import { exactlySelectedGroup } from "../model/groups";
import { shapeWorldMatrix } from "@/model/geometry/matrix";
import { scopeRootGroupId } from "../model/scene";
import type { Guide, Spacing } from "@/model/geometry/snap";
import type { Bounds, PathShape, Shape, Vec2 } from "../model/types";
import { currentSymbolScope, type EditorState } from "../store/editorStore";
import type { CanvasTheme } from "./canvasTheme";
import { cornerRadiusControl } from "./cornerRadiusHandle";
import { getSelectionFrame } from "./frame";
import { HANDLE_SIZE } from "./handles";
import { TOUCH_DRAW_SCALE, type Interaction } from "./interaction";
import { ANCHOR_SIZE, HANDLE_DOT } from "./nodes";
import {
  drawArtboardChrome,
  drawGuides,
  drawNodes,
  drawOverlay,
  drawPenDraft,
  drawSpacings,
  drawTextDraft,
} from "./overlay";
import { selectedNodeShapes, selectedShapes } from "./picking";
import { renderScene } from "./render";

/** Everything the canvas painter reads: a store snapshot plus transient refs. */
export interface PaintInput {
  ctx2d: CanvasRenderingContext2D;
  size: { width: number; height: number; dpr: number };
  state: EditorState;
  theme: CanvasTheme;
  coarse: boolean;
  preview: Shape | null;
  marquee: Bounds | null;
  interaction: Interaction;
  penDraft: PathShape | null;
  hover: Vec2 | null;
  guides: Guide[];
  spacings: Spacing[];
  /** Shape hidden from the scene while its text is being edited in the DOM. */
  hiddenTextId: string | null;
}

/** Paint the scene and all tool chrome for one frame. Pure w.r.t. its inputs. */
export function paintCanvas(input: PaintInput): void {
  const {
    ctx2d,
    size,
    state,
    theme,
    coarse,
    preview,
    marquee,
    interaction,
    penDraft,
    hover,
    guides,
    spacings,
    hiddenTextId,
  } = input;
  const { width, height, dpr } = size;
  const { doc, viewport, selection, tool } = state;

  // Symbol local view: paint only the edited definition on a tinted page.
  const scope = currentSymbolScope(state);
  const scopeRoot = scopeRootGroupId(doc, scope);
  renderScene(ctx2d, {
    width,
    height,
    dpr,
    viewport,
    doc,
    preview,
    background: scope ? theme.scopeBg : theme.bg,
    showGrid: state.gridVisible,
    gridSize: state.gridSize,
    gridColors: theme.grid,
    rootIds: scopeRoot !== null ? [scopeRoot] : undefined,
    artboards: scope ? undefined : doc.artboards,
    hiddenShapeId: hiddenTextId,
  });

  const chrome = coarse ? TOUCH_DRAW_SCALE : 1;
  const selected = selectedShapes(doc, selection);
  drawOverlay(ctx2d, {
    dpr,
    viewport,
    frame:
      tool === "select"
        ? getSelectionFrame(
            doc,
            selected,
            exactlySelectedGroup(doc, selection),
            state.selectionPivot,
            state.selectionTransform
          )
        : null,
    marquee,
    showHandles: tool === "select" && selected.length > 0,
    handleSize: HANDLE_SIZE * chrome,
    cornerRadiusHandle:
      tool === "select"
        ? cornerRadiusControl(doc, selection, viewport, chrome)?.point ?? null
        : null,
    activeGroupBounds:
      tool === "select" && state.activeGroupId && doc.nodes[state.activeGroupId]
        ? unionNodeWorldBounds(doc, [state.activeGroupId])
        : null,
  });

  if (tool === "artboard" && scope === null) {
    drawArtboardChrome(
      ctx2d,
      dpr,
      viewport,
      doc.artboards,
      state.selectedArtboardId,
      HANDLE_SIZE * chrome
    );
  }

  if (tool === "node") {
    for (const sel of selectedNodeShapes(state)) {
      const active = state.editNodes
        .filter((node) => node.shapeId === sel.id)
        .map(({ sub, index }) => ({ sub, index }));
      drawNodes(
        ctx2d,
        dpr,
        viewport,
        sel,
        shapeWorldMatrix(doc, sel),
        active,
        ANCHOR_SIZE * chrome,
        HANDLE_DOT * chrome
      );
    }
  }
  if (tool === "pen" && penDraft) {
    drawPenDraft(
      ctx2d,
      dpr,
      viewport,
      penDraft,
      shapeWorldMatrix(doc, penDraft),
      hover
    );
  }
  if (interaction.kind === "text-create") {
    drawTextDraft(ctx2d, dpr, viewport, interaction.start, interaction.current);
  }
  drawGuides(ctx2d, dpr, viewport, guides);
  drawSpacings(ctx2d, dpr, viewport, spacings);
}
