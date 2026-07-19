import { computeBucketFill } from "../../model/bucketFill";
import { IDENTITY } from "../../model/matrix";
import { makeId, type PolygonShape } from "../../model/types";
import type { Vec2 } from "../../model/types";
import { useBucket } from "../../store/bucketStore";
import type { EditorState } from "../../store/editorStore";
import { currentSymbolScope } from "../../store/state";
import { notify } from "../../store/toastStore";

/**
 * Bucket Fill: click an empty region enclosed by visible ink to fill it with
 * the current fill color. The region is computed vectorially (see
 * docs/bucket-fill.md) and committed as a polygon *below* the surrounding ink,
 * so outlines keep painting on top of the fill.
 */
export function bucketFillAt(state: EditorState, world: Vec2): void {
  const paint = state.style.fill ?? state.style.stroke;
  if (!paint) {
    notify.info("Choose a fill color first.");
    return;
  }
  const result = computeBucketFill(
    state.doc,
    currentSymbolScope(state),
    world,
    useBucket.getState().gapTolerance
  );
  if (result.kind === "open") {
    notify.info(
      "This area isn't enclosed. Close the gaps or raise the gap tolerance."
    );
    return;
  }
  if (result.kind === "inked") {
    notify.info("There's no empty area to fill here.");
    return;
  }
  const shape: PolygonShape = {
    id: makeId("polygon"),
    name: "Fill",
    type: "polygon",
    polys: result.polys,
    fill: paint,
    stroke: null,
    strokeWidth: 1,
    opacity: 1,
    transform: [...IDENTITY],
    transformOrigin: null,
  };
  state.addFillShape(shape, result.coverId);
}
