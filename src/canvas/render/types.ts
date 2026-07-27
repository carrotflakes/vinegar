import type { Document, Shape } from "@/model/types";
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
  /** Paint these roots instead of `doc.rootIds` (symbol local view). */
  rootIds?: string[] | undefined;
  /** Omit this shape while an HTML overlay edits it. */
  hiddenShapeId?: string | null;
  /** Draw editor-only chrome (transparent-frame checkerboard). Off for export. */
  editorChrome?: boolean;
  /** Optional per-frame diagnostics for stress-document profiling. */
  onPerformanceSample?: ((sample: RenderPerformanceSample) => void) | undefined;
}
