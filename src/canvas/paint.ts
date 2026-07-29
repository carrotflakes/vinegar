import { unionNodeWorldBounds } from "@/model/geometry/bounds";
import { exactlySelectedGroup } from "../model/groups";
import { applyMatrix, nodeWorldMatrix, shapeWorldMatrix } from "@/model/geometry/matrix";
import { framesInPaintOrder, isFrame, scopeRootGroupId, selectionRoots } from "../model/scene";
import type { Guide, Spacing } from "@/model/geometry/snap";
import type { Bounds, PathShape, Shape, Vec2 } from "../model/types";
import { currentSymbolScope, type EditorState } from "../store/editorStore";
import { usePreferences } from "../store/preferencesStore";
import type { CanvasTheme } from "./canvasTheme";
import { cornerRadiusControl } from "./cornerRadiusHandle";
import {
  frameNodeSelectionFrame,
  getSelectionFrame,
  singleSelectedFrame,
} from "./frame";
import { HANDLE_SIZE } from "./handles";
import { TOUCH_DRAW_SCALE, type Interaction } from "./interaction";
import { ANCHOR_SIZE, HANDLE_DOT, WIDTH_KNOB } from "./nodes";
import {
  drawFrameDropTarget,
  drawBrushCursor,
  drawFrameLabels,
  drawGuides,
  drawNodes,
  drawOverlay,
  drawPenDraft,
  drawSpacings,
  drawTextDraft,
} from "./overlay";
import { drawDocumentGuides } from "./guides";
import { drawNodeHighlight } from "./highlight";
import { drawRulers, RULER_SIZE } from "./rulers";
import { selectedNodeShapes, selectedShapes } from "./picking";
import { frameDropTarget } from "./tools/selectTool";
import { renderScene } from "./render/scene";

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
  /** Hovering pen tip for the brush/eraser, with its radius in world units. */
  brushHover: { p: Vec2; radius: number } | null;
  guides: Guide[];
  spacings: Spacing[];
  /** Shape hidden from the scene while its text is being edited in the DOM. */
  hiddenTextId: string | null;
  /** Node hovered in the Layers panel, outlined so the row maps to the art.
   *  `pulse` (1 → 0) is the strength of its brief entry animation. */
  highlight: { nodeId: string; pulse: number } | null;
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
    brushHover,
    guides,
    spacings,
    hiddenTextId,
    highlight,
  } = input;
  const { width, height, dpr } = size;
  const { doc, viewport, selection, tool } = state;

  // Symbol local view: paint only the edited definition; the breadcrumb is
  // the mode indicator (see SymbolBreadcrumb.tsx).
  const scope = currentSymbolScope(state);
  const scopeRoot = scopeRootGroupId(doc, scope);
  renderScene(ctx2d, {
    width,
    height,
    dpr,
    viewport,
    doc,
    preview,
    background: theme.bg,
    showGrid: state.gridVisible,
    gridSize: state.gridSize,
    gridColors: theme.grid,
    rootIds: scopeRoot !== null ? [scopeRoot] : undefined,
    hiddenShapeId: hiddenTextId,
    editorChrome: true,
  });

  // Persistent guides sit above the art but below every selection affordance.
  if (state.guidesVisible) {
    drawDocumentGuides(
      ctx2d,
      dpr,
      viewport,
      { width, height },
      doc.guides,
      state.selectedGuideId
    );
  }

  // While dragging a selection, highlight the frame it would drop into (unless
  // reparenting is suppressed with Cmd/Ctrl).
  if (interaction.kind === "move" && !interaction.noReparent && scope === null) {
    const movable = selectionRoots(doc, selection).filter(
      (id) => !isFrame(doc.nodes[id])
    );
    const targetId = movable.length ? frameDropTarget(doc, movable) : null;
    const target = targetId ? doc.nodes[targetId] : null;
    if (target && isFrame(target)) {
      const m = nodeWorldMatrix(doc, target.id);
      drawFrameDropTarget(ctx2d, dpr, viewport, [
        applyMatrix(m, { x: 0, y: 0 }),
        applyMatrix(m, { x: target.width, y: 0 }),
        applyMatrix(m, { x: target.width, y: target.height }),
        applyMatrix(m, { x: 0, y: target.height }),
      ]);
    }
  }

  const chrome = coarse ? TOUCH_DRAW_SCALE : 1;
  const selected = selectedShapes(doc, selection);
  // A lone selected frame is framed by its content box; everything else uses the
  // leaf-union selection frame.
  const soleFrame = scope === null ? singleSelectedFrame(doc, selection) : null;
  const selectionFrame = soleFrame
    ? frameNodeSelectionFrame(doc, soleFrame)
    : getSelectionFrame(
        doc,
        selected,
        exactlySelectedGroup(doc, selection),
        state.selectionPivot,
        state.selectionTransform
      );
  drawOverlay(ctx2d, {
    dpr,
    viewport,
    frame: tool === "select" ? selectionFrame : null,
    marquee,
    showHandles: tool === "select" && selectionFrame !== null,
    // Frames are never rotated, so hide their rotation stalk and pivot marker.
    hideRotate: soleFrame !== null,
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

  // Frame name labels above each frame (scene scope only).
  if (scope === null) {
    const selected = new Set(selection);
    drawFrameLabels(
      ctx2d,
      dpr,
      viewport,
      framesInPaintOrder(doc).map((frame) => ({
        name: frame.name,
        topLeft: applyMatrix(nodeWorldMatrix(doc, frame.id), { x: 0, y: 0 }),
        selected: selected.has(frame.id),
      }))
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
        HANDLE_DOT * chrome,
        WIDTH_KNOB * chrome
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
  if (brushHover && (tool === "brush" || tool === "eraser")) {
    drawBrushCursor(ctx2d, dpr, viewport, brushHover.p, brushHover.radius);
  }
  if (interaction.kind === "text-create") {
    drawTextDraft(ctx2d, dpr, viewport, interaction.start, interaction.current);
  }
  // Layers-panel hover outline: above the art and the selection frame, below
  // the snapping chrome and the rulers.
  if (highlight && doc.nodes[highlight.nodeId]) {
    drawNodeHighlight(ctx2d, {
      dpr,
      size: { width, height },
      viewport,
      doc,
      nodeId: highlight.nodeId,
      pulse: highlight.pulse,
      rulerInset: state.rulersVisible ? RULER_SIZE : 0,
    });
  }

  drawGuides(ctx2d, dpr, viewport, guides);
  drawSpacings(ctx2d, dpr, viewport, spacings);

  // Rulers last: they are opaque bands the rest of the chrome scrolls under.
  if (state.rulersVisible) {
    drawRulers(ctx2d, {
      dpr,
      size: { width, height },
      viewport,
      doc,
      // "world" pins the rulers to the document origin regardless of which
      // frame is active (Illustrator's Global Rulers).
      activeFrameId:
        usePreferences.getState().canvas.rulerOrigin === "world"
          ? null
          : state.activeFrameId,
      theme,
      selection: selectionFrame
        ? unionNodeWorldBounds(doc, selectionRoots(doc, selection))
        : null,
    });
  }
}
