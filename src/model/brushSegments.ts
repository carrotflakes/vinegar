import type { CubicSegment } from "./path";
import type { BrushShape } from "./types";

/** One cubic segment of a brush centerline, including endpoint widths. */
export interface BrushSegment extends CubicSegment {
  w0: number;
  w1: number;
}

/** Cubic segments of an open brush centerline in anchor order. */
export function brushSegments(shape: BrushShape): BrushSegment[] {
  const segments: BrushSegment[] = [];
  for (let i = 0; i + 1 < shape.anchors.length; i++) {
    const current = shape.anchors[i];
    const next = shape.anchors[i + 1];
    segments.push({
      p0: current.p,
      c1: current.hOut ?? current.p,
      c2: next.hIn ?? next.p,
      p1: next.p,
      w0: current.w,
      w1: next.w,
    });
  }
  return segments;
}
