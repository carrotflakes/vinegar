import { create } from "zustand";
import type { Vec2 } from "../model/types";

/**
 * Pointer position in world coordinates, kept out of the editor store so its
 * high-frequency updates don't trigger canvas redraw subscribers.
 */
export const usePointer = create<{ pos: Vec2 | null }>(() => ({ pos: null }));

export function setPointer(pos: Vec2 | null) {
  usePointer.setState({ pos });
}
