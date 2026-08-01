// Screen-space geometry for a selected generator node's parameter knobs — the
// canvas counterpart of the properties panel's sliders. Mirrors
// `cornerRadiusHandle.ts`: a pure `doc -> controls` function shared by the
// overlay painter, hit-testing and the drag.

import { GENERATORS, defaultArgs, type GeneratorParam } from "@/model/generators/generators";
import { generatorHandles, type GeneratorHandle } from "@/model/generators/handles";
import { applyMatrix, shapeWorldMatrix } from "@/model/geometry/matrix";
import { isShape } from "@/model/scene";
import type { Document, Matrix, Vec2 } from "../model/types";
import { worldToScreen, type Viewport } from "@/model/geometry/viewport";

export interface GeneratorControl {
  shapeId: string;
  param: GeneratorParam;
  /** Local-space descriptor, rebuilt from the node's current args. */
  handle: GeneratorHandle;
  /** Screen-space centre of the visible knob. */
  point: Vec2;
  /** Node local space -> world. */
  matrix: Matrix;
  value: number;
}

/**
 * Parameter knobs for a single directly selected generator node. Only built-in
 * generators define handles today; document scripts fall back to the panel.
 */
export function generatorControls(
  doc: Document,
  selection: string[],
  viewport: Viewport
): GeneratorControl[] {
  if (selection.length !== 1) return [];
  const shape = doc.nodes[selection[0]];
  if (!isShape(shape) || shape.type !== "path" || !shape.generator) return [];
  if (shape.locked) return [];
  const def = GENERATORS[shape.generator.scriptId];
  if (!def) return [];

  const args = { ...defaultArgs(def), ...shape.generator.args };
  const byKey = new Map(def.params.map((p) => [p.key, p]));
  const matrix = shapeWorldMatrix(doc, shape);
  const controls: GeneratorControl[] = [];
  for (const handle of generatorHandles(def.id, args)) {
    const param = byKey.get(handle.param);
    if (!param) continue;
    controls.push({
      shapeId: shape.id,
      param,
      handle,
      point: worldToScreen(viewport, applyMatrix(matrix, handle.at)),
      matrix,
      value: args[handle.param] ?? param.default,
    });
  }
  return controls;
}

/** The knob under `screen`, if any. Later knobs win, matching paint order. */
export function pickGeneratorControl(
  controls: GeneratorControl[],
  screen: Vec2,
  tolerance: number
): GeneratorControl | null {
  let hit: GeneratorControl | null = null;
  for (const control of controls) {
    if (
      Math.abs(control.point.x - screen.x) <= tolerance &&
      Math.abs(control.point.y - screen.y) <= tolerance
    ) {
      hit = control;
    }
  }
  return hit;
}
