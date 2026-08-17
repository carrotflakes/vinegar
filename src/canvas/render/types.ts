import type { Document, Matrix, Shape } from "@/model/types";
import type { Viewport } from "@/model/geometry/viewport";

export interface RenderPerformanceSample {
  paintNodeMs: number;
  acquireLayerCalls: number;
  /** Sum of allocated/borrowed layer areas for this frame, in device pixels. */
  acquiredLayerPixels: number;
  paintedNodes: number;
  culledNodes: number;
}

export interface RenderOptions {
  width: number;
  height: number;
  dpr: number;
  viewport: Viewport;
  doc: Document;
  /** Transient shape being drawn (rubber-band preview). */
  preview?: Shape | null;
  background?: string;
  showGrid?: boolean;
  /** World units between grid lines (defaults to 50). */
  gridSize?: number;
  /** Grid line colors per tier; falls back to light-theme defaults. */
  gridColors?: { minor: string; major: string; axis: string };
  /** Paint these roots instead of `doc.rootIds` (focus / symbol local view). */
  rootIds?: string[] | undefined;
  /**
   * World matrix `rootIds` are painted relative to — their parent's world
   * matrix — so a focused container still lands at its true world position and
   * agrees with culling, bounds and hit-testing, which are all world-space.
   * Omit (identity) for scene roots and symbol definition roots, which have no
   * parent. See docs/design/focus.md.
   */
  rootBaseMatrix?: Matrix | undefined;
  /** Omit this shape while an HTML overlay edits it. */
  hiddenShapeId?: string | null;
  /** Draw editor-only chrome (transparent-frame checkerboard). Off for export. */
  editorChrome?: boolean;
  /** Optional per-frame diagnostics for stress-document profiling. */
  onPerformanceSample?: ((sample: RenderPerformanceSample) => void) | undefined;
}
