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

  interface ClipperLibStatic {
    ClipperOffset: typeof ClipperOffset;
    PolyTree: typeof PolyTree;
    JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
    EndType: {
      etOpenSquare: number;
      etOpenRound: number;
      etOpenButt: number;
      etClosedLine: number;
      etClosedPolygon: number;
    };
  }

  const ClipperLib: ClipperLibStatic;
  export default ClipperLib;
}
