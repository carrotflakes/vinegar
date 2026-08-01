import { useEffect, useRef } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";
import { expandToGroups, isWithinGroup } from "../../model/groups";
import { isGroup } from "../../model/scene";
import { screenToWorld } from "@/model/geometry/viewport";
import { currentFocusRoot, useEditor } from "../../store/editorStore";
import { openContextMenu } from "../../store/menuStore";
import { canvasMenu, guideMenu, nodeMenu, selectionMenu } from "../../ui/menus";
import { pickGuide } from "../guides";
import { NODE_GRAB, type ToolContext } from "../interaction";
import { hitNodes } from "../nodes";
import { shapeWorldMatrix } from "@/model/geometry/matrix";
import { cancelActiveInteraction } from "../interactionLifecycle";
import { pickShape, selectedNodeShapes } from "../picking";
import { overRulers } from "../rulers";

const LONG_PRESS_DELAY = 500;
const LONG_PRESS_TOLERANCE = 10;

interface PendingLongPress {
  pointerId: number;
  clientX: number;
  clientY: number;
  timer: number | null;
  fired: boolean;
}

interface CanvasContextMenuDeps {
  ctx: ToolContext;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  sizeRef: RefObject<{ width: number; height: number; dpr: number }>;
}

/** Right-click and touch long-press handling for the canvas context menu. */
export function useCanvasContextMenu({
  ctx,
  canvasRef,
  sizeRef,
}: CanvasContextMenuDeps) {
  const pendingRef = useRef<PendingLongPress | null>(null);
  const swallowedClickRef = useRef<((e: MouseEvent) => void) | null>(null);
  const swallowedClickTimerRef = useRef<number | null>(null);

  const openAt = (clientX: number, clientY: number) => {
    const state = useEditor.getState();
    const rect = canvasRef.current!.getBoundingClientRect();
    const screen = { x: clientX - rect.left, y: clientY - rect.top };
    const world = screenToWorld(state.viewport, screen);
    const size = sizeRef.current;
    const onRuler = state.rulersVisible && overRulers(screen, size);
    const guide = state.guidesVisible
      ? pickGuide(state.doc, state.viewport, screen, size, 4 * ctx.hitScale())
      : null;

    if (onRuler || guide) {
      if (guide && !state.guidesLocked) state.setSelectedGuide(guide.id);
      openContextMenu(clientX, clientY, guideMenu());
      return;
    }

    // A right-click on an anchor acts on the anchors, not on the shape. The
    // pressed one joins the selection first when it wasn't part of it, the same
    // rule a left-click follows.
    if (state.tool === "node") {
      const target = selectedNodeShapes(state).flatMap((shape) => {
        const hit = hitNodes(
          shape,
          shapeWorldMatrix(state.doc, shape),
          screen,
          state.viewport,
          NODE_GRAB * ctx.hitScale(),
          true
        );
        return hit && hit.part === "anchor" ? [{ shape, hit }] : [];
      })[0];
      if (target) {
        const { shape, hit } = target;
        const already = state.editNodes.some(
          (node) => node.shapeId === shape.id && node.sub === hit.sub && node.index === hit.index
        );
        if (!already) {
          state.setEditNodes([{ shapeId: shape.id, sub: hit.sub, index: hit.index }]);
        }
        openContextMenu(clientX, clientY, nodeMenu());
        return;
      }
    }

    if (state.tool === "select" || state.tool === "node") {
      const hitId = pickShape(ctx, world);
      if (hitId) {
        const focusRoot = currentFocusRoot(state);
        const activeGroup =
          state.activeGroupId && isGroup(state.doc.nodes[state.activeGroupId])
            ? state.activeGroupId
            : null;
        const insideActive =
          activeGroup != null && isWithinGroup(state.doc, hitId, activeGroup);
        if (activeGroup && !insideActive) state.setActiveGroup(null);
        const scopeRoot = insideActive ? activeGroup : focusRoot;
        const expanded = expandToGroups(state.doc, [hitId], scopeRoot);
        if (!expanded.some((id) => state.selection.includes(id))) {
          state.setSelection(expanded);
        }
        openContextMenu(clientX, clientY, selectionMenu());
        return;
      }
    }

    openContextMenu(clientX, clientY, canvasMenu(world));
  };

  const clearSwallowedClick = () => {
    if (swallowedClickRef.current) {
      window.removeEventListener("click", swallowedClickRef.current, true);
      swallowedClickRef.current = null;
    }
    if (swallowedClickTimerRef.current != null) {
      window.clearTimeout(swallowedClickTimerRef.current);
      swallowedClickTimerRef.current = null;
    }
  };

  const swallowNextClick = () => {
    clearSwallowedClick();
    const swallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      clearSwallowedClick();
    };
    swallowedClickRef.current = swallow;
    window.addEventListener("click", swallow, true);
    swallowedClickTimerRef.current = window.setTimeout(clearSwallowedClick, 700);
  };

  const cancelTouch = (pointerId?: number) => {
    const pending = pendingRef.current;
    if (!pending || (pointerId != null && pending.pointerId !== pointerId)) return;
    if (pending.timer != null) window.clearTimeout(pending.timer);
    pendingRef.current = null;
  };

  const showPending = () => {
    const pending = pendingRef.current;
    if (!pending || pending.fired) return;
    pending.fired = true;
    pending.timer = null;
    if (ctx.interaction.current.kind !== "none") cancelActiveInteraction(ctx);
    swallowNextClick();
    openAt(pending.clientX, pending.clientY);
  };

  const startTouch = (pointerId: number, clientX: number, clientY: number) => {
    const pending: PendingLongPress = {
      pointerId,
      clientX,
      clientY,
      timer: null,
      fired: false,
    };
    pending.timer = window.setTimeout(showPending, LONG_PRESS_DELAY);
    pendingRef.current = pending;
  };

  const moveTouch = (pointerId: number, clientX: number, clientY: number) => {
    const pending = pendingRef.current;
    if (!pending || pending.pointerId !== pointerId || pending.fired) return;
    const distance = Math.hypot(
      clientX - pending.clientX,
      clientY - pending.clientY
    );
    if (distance > LONG_PRESS_TOLERANCE) cancelTouch(pointerId);
  };

  const endTouch = (pointerId: number) => cancelTouch(pointerId);

  const onContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pending = pendingRef.current;
    // Some browsers emit a native contextmenu event for a touch hold.
    if (pending) {
      if (!pending.fired) showPending();
      return;
    }
    openAt(e.clientX, e.clientY);
  };

  useEffect(
    () => () => {
      cancelTouch();
      clearSwallowedClick();
    },
    []
  );

  return {
    startTouch,
    moveTouch,
    endTouch,
    cancelTouch,
    onContextMenu,
  };
}
