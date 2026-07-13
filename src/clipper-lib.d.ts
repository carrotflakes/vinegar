// Minimal typings for clipper-lib (no official types). Covers the polygon
// offsetting API used for stroke-to-path.
declare module "clipper-lib" {
  export interface IntPoint {
    X: number;
    Y: number;
  }

  export class PolyNode {
    Childs(): PolyNode[];
    Contour(): IntPoint[];
    IsHole(): boolean;
  }

  export class PolyTree extends PolyNode {}

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: IntPoint[], joinType: number, endType: number): void;
    Execute(solution: PolyTree, delta: number): void;
  }

  export class Clipper {
    AddPaths(paths: IntPoint[][], polyType: number, closed: boolean): boolean;
    Execute(
      clipType: number,
      solution: PolyTree,
      subjectFillType?: number,
      clipFillType?: number
    ): boolean;
  }

  interface ClipperLibStatic {
    ClipperOffset: typeof ClipperOffset;
    Clipper: typeof Clipper;
    PolyTree: typeof PolyTree;
    JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
    EndType: {
      etOpenSquare: number;
      etOpenRound: number;
      etOpenButt: number;
      etClosedLine: number;
      etClosedPolygon: number;
    };
    PolyType: { ptSubject: number; ptClip: number };
    ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number };
    PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number };
  }

  const ClipperLib: ClipperLibStatic;
  export default ClipperLib;
}
