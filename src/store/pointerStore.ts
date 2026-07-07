import { create } from "zustand";
import type { Vec2 } from "../model/types";

/**
 * Pointer position in world coordinates, kept out of the editor store so its
 * high-frequency updates don't trigger canvas redraw subscribers.
 * `readout` is a short live description of the current interaction (W×H while
 * creating, ΔX/ΔY while moving, angle while rotating); it replaces the
 * position in the status bar while a drag is in progress.
 */
export const usePointer = create<{ pos: Vec2 | null; readout: string | null }>(
  () => ({ pos: null, readout: null })
);

export function setPointer(pos: Vec2 | null) {
  usePointer.setState({ pos });
}

export function setReadout(readout: string | null) {
  if (usePointer.getState().readout !== readout) usePointer.setState({ readout });
}
