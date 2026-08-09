import { create } from "zustand";
import { isFreeform, removeFreeformPoint } from "@/model/freeform";
import type { PaintTarget } from "@/model/paint";
import { isShape } from "@/model/scene";
import type { Document, Shape } from "@/model/types";
import type { EditorState } from "./state";

/**
 * Session state for the gradient tool: which of a shape's two paints it edits
 * and which stop is active. Kept out of the editor store because nothing here
 * is part of the document or worth persisting — it is the tool's own focus,
 * the way `penDraftStore` holds the pen's.
 */
interface GradientToolState {
  target: PaintTarget;
  /**
   * Id of the active sub-object of whichever paint is being edited — a ramp
   * stop, or a freeform colour point. Null selects the first one.
   */
  stopId: string | null;
  setTarget: (target: PaintTarget) => void;
  setStopId: (id: string | null) => void;
}

export const useGradientTool = create<GradientToolState>((set) => ({
  target: "fill",
  stopId: null,
  setTarget: (target) => set({ target, stopId: null }),
  setStopId: (stopId) => set({ stopId }),
}));

/** The shape the gradient tool acts on: the single selected one, if any. */
export function gradientTargetShape(doc: Document, selection: string[]): Shape | null {
  if (selection.length !== 1) return null;
  const node = doc.nodes[selection[0]!];
  return isShape(node) && !node.locked ? node : null;
}

/**
 * Remove the colour point the gradient tool has active, and say whether it
 * did. `edit.delete` calls this before deleting anything else: while a
 * freeform field is what the user is editing, Delete belongs to the point —
 * the shape is not what is on screen to be removed. The last point stays (a
 * field needs one), and then this returns false so Delete falls through to its
 * usual meaning.
 */
export function deleteActiveFreeformPoint(state: EditorState): boolean {
  const { target, stopId } = useGradientTool.getState();
  const shape = gradientTargetShape(state.doc, state.selection);
  const paint = shape ? shape[target] : null;
  if (!isFreeform(paint)) return false;
  const id = paint.points.find((p) => p.id === stopId)?.id ?? paint.points[0]?.id;
  if (!id) return false;
  const next = removeFreeformPoint(paint, id);
  if (next === paint) return false;
  state.updateSelectedStyle({ [target]: next });
  useGradientTool.getState().setStopId(null);
  return true;
}
