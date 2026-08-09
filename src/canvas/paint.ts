import { unionNodeWorldBounds } from "@/model/geometry/bounds";
import { exactlySelectedGroup } from "../model/groups";
import { applyMatrix, nodeWorldMatrix, shapeWorldMatrix } from "@/model/geometry/matrix";
import { framesInPaintOrder, isFrame, parentIdOf, selectionRoots } from "../model/scene";
import type { Guide, Spacing } from "@/model/geometry/snap";
import type { Bounds, PathShape, Shape, Vec2 } from "../model/types";
import { currentFocusRoot, type EditorState } from "../store/editorStore";
import { usePreferences } from "../store/preferencesStore";
import type { CanvasTheme } from "./canvasTheme";
import { cornerRadiusControl } from "./cornerRadiusHandle";
import { generatorControls } from "./generatorHandles";
import { freeformControls } from "./freeformHandles";
import { gradientControls } from "./gradientHandles";
import { gradientTargetShape, useGradientTool } from "@/store/gradientToolStore";
import {
  frameNodeSelectionFrame,
  getSelectionFrame,
  isMixedFrameSelection,
  singleSelectedFrame,
} from "./frame";
import { HANDLE_SIZE } from "./handles";
import {
  TOUCH_DRAW_SCALE,
  type Interaction,
  type PenHover,
} from "./interaction";
import {
  ANCHOR_SIZE,
  HANDLE_DOT,
  WIDTH_KNOB,
  visibleHandleKeys,
} from "./nodes";
import {
  drawFrameDropTarget,
  drawBrushCursor,
  drawEndpointHint,
  drawFrameLabels,
  drawGuides,
  drawNodes,
  drawFreeformAnnotator,
  drawGradientAnnotator,
  drawOverlay,
  drawPenDraft,
  drawSpacings,
  drawTextDraft,
} from "./overlay";
import { drawDocumentGuides } from "./guides";
import { drawNodeHighlight } from "./highlight";
import { drawRulers, RULER_SIZE } from "./rulers";
import { selectedNodeShapes, selectedShapes } from "./picking";
import {
  frameDropTarget,
  type CachedSelectHover,
} from "./tools/selectTool";
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
  /** Where the pen would place its next anchor, drawn as a rubber band. */
  hover: PenHover | null;
  /** Hovering pen tip for the brush/eraser, with its radius in world units. */
  brushHover: { p: Vec2; radius: number } | null;
  /** What the select tool is hovering, outlined to say what a click would take. */
  selectHover: CachedSelectHover | null;
  /** World position of the open-path endpoint the pencil or pen would continue. */
  endpointHint: Vec2 | null;
  /** Start point of the live freehand stroke while releasing would close it. */
  closeHint: Vec2 | null;
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
    selectHover,
    endpointHint,
    closeHint,
    guides,
    spacings,
    hiddenTextId,
    highlight,
  } = input;
  const { width, height, dpr } = size;
  const { doc, viewport, selection, tool } = state;

  // Focus (isolation) view: paint only the focused container's subtree; the
  // breadcrumb is the mode indicator (see FocusBreadcrumb.tsx).
  const scope = currentFocusRoot(state);
  renderScene(ctx2d, {
    rootBaseMatrix:
      scope !== null ? nodeWorldMatrix(doc, parentIdOf(doc, scope)) : undefined,
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
    rootIds: scope !== null ? [scope] : undefined,
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
    showHandles:
      tool === "select" &&
      selectionFrame !== null &&
      !isMixedFrameSelection(doc, selection),
    // Frames are never rotated, so hide their rotation stalk and pivot marker.
    hideRotate: soleFrame !== null,
    handleSize: HANDLE_SIZE * chrome,
    cornerRadiusHandle:
      tool === "select"
        ? cornerRadiusControl(doc, selection, viewport, chrome)?.point ?? null
        : null,
    generatorHandles:
      tool === "select"
        ? generatorControls(doc, selection, viewport).map((c) => c.point)
        : null,
    activeGroupBounds:
      tool === "select" && state.activeGroupId && doc.nodes[state.activeGroupId]
        ? unionNodeWorldBounds(doc, [state.activeGroupId])
        : null,
  });

  // The gradient tool's annotator, drawn over its shape — the ramp's axis, or
  // the scattered colour points of a freeform field.
  if (tool === "gradient") {
    const { target, stopId } = useGradientTool.getState();
    const shape = gradientTargetShape(doc, selection);
    const controls = gradientControls(doc, shape, target, viewport, chrome);
    if (controls) drawGradientAnnotator(ctx2d, dpr, controls, stopId, chrome);
    const freeform = freeformControls(doc, shape, target, viewport, stopId, chrome);
    if (freeform) drawFreeformAnnotator(ctx2d, dpr, freeform, stopId, chrome);
  }

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
    const showAllHandles = usePreferences.getState().canvas.showAllHandles;
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
        WIDTH_KNOB * chrome,
        visibleHandleKeys(sel, active, showAllHandles)
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
  if (endpointHint && (tool === "pencil" || tool === "pen")) {
    drawEndpointHint(ctx2d, dpr, viewport, endpointHint);
  }
  // Same ring, different question: "release here and the path closes". Only a
  // live stroke sets it, so no tool gate is needed.
  if (closeHint) drawEndpointHint(ctx2d, dpr, viewport, closeHint);
  if (interaction.kind === "text-create") {
    drawTextDraft(ctx2d, dpr, viewport, interaction.start, interaction.current);
  }
  // A locked node under the pointer, outlined as locked — first, so the accent
  // outline of whatever the click *would* take draws over it where they meet.
  const lockedHoverId = selectHover?.lockedId ?? null;
  if (
    lockedHoverId &&
    interaction.kind === "none" &&
    doc.nodes[lockedHoverId] &&
    !selection.includes(lockedHoverId)
  ) {
    drawNodeHighlight(ctx2d, {
      dpr,
      size: { width, height },
      viewport,
      doc,
      nodeId: lockedHoverId,
      pulse: 0,
      rulerInset: state.rulersVisible ? RULER_SIZE : 0,
      variant: "locked",
    });
  }

  // What a click would select, outlined under the pointer. Drawn with the same
  // accent as the Layers-panel hover — it means the same thing — and skipped
  // for anything already selected, whose selection frame says it louder.
  const hoverId = selectHover?.targetId ?? null;
  if (
    hoverId &&
    interaction.kind === "none" &&
    doc.nodes[hoverId] &&
    hoverId !== highlight?.nodeId &&
    !selection.includes(hoverId)
  ) {
    drawNodeHighlight(ctx2d, {
      dpr,
      size: { width, height },
      viewport,
      doc,
      nodeId: hoverId,
      pulse: 0,
      rulerInset: state.rulersVisible ? RULER_SIZE : 0,
    });
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
