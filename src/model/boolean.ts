import * as paperNs from "paper";
// paper ships as CJS; depending on the bundler/SSR interop the library lands
// either on the namespace itself or on its `default`.
const paper: typeof paperNs =
  (paperNs as { default?: typeof paperNs }).default ?? paperNs;
import { shapeBounds } from "./bounds";
import { IDENTITY } from "./matrix";
import { roundedRectSubpath } from "./roundedRect";
import { strokeDetailFields } from "./stroke";
import {
  makeId,
  type BezierShape,
  type BezierSubpath,
  type Shape,
  type Vec2,
} from "./types";

export type BoolOp = "union" | "subtract" | "intersect" | "xor";

/** Paper.js needs a project before any path can be built; set one up lazily. */
let paperReady = false;
function ensurePaper(): void {
  if (paperReady) return;
  paper.setup(new paper.Size(1, 1));
  paperReady = true;
}

function toPaperMatrix(m: Shape["transform"]): paper.Matrix {
  return new paper.Matrix(m[0], m[1], m[2], m[3], m[4], m[5]);
}

function subpathToPath(sp: BezierSubpath): paper.Path {
  const segments = sp.anchors.map(
    (a) =>
      new paper.Segment(
        new paper.Point(a.p.x, a.p.y),
        a.hIn
          ? new paper.Point(a.hIn.x - a.p.x, a.hIn.y - a.p.y)
          : undefined,
        a.hOut
          ? new paper.Point(a.hOut.x - a.p.x, a.hOut.y - a.p.y)
          : undefined
      )
  );
  const path = new paper.Path({ segments, insert: false });
  path.closed = sp.closed;
  return path;
}

function ringToPath(ring: Vec2[]): paper.Path {
  const path = new paper.Path({
    segments: ring.map((p) => new paper.Point(p.x, p.y)),
    insert: false,
  });
  path.closed = true;
  return path;
}

function compound(paths: paper.Path[]): paper.PathItem | null {
  if (paths.length === 0) return null;
  if (paths.length === 1) return paths[0];
  return new paper.CompoundPath({ children: paths, insert: false });
}

function pathsOf(item: paper.PathItem | null): paper.Path[] {
  if (!item) return [];
  return item instanceof paper.CompoundPath
    ? (item.children as paper.Path[])
    : [item as paper.Path];
}

/**
 * Convert a shape into paper.js geometry in its parent's coordinate space
 * (the shape's own transform baked in), or null if it encloses no area.
 * Curves are preserved exactly — no flattening.
 */
function shapeToGeom(shape: Shape): paper.PathItem | null {
  let item: paper.PathItem | null;
  switch (shape.type) {
    case "rect": {
      item = subpathToPath(roundedRectSubpath(shape));
      break;
    }
    case "ellipse": {
      const b = shapeBounds(shape);
      item = new paper.Path.Ellipse({
        point: [b.x, b.y],
        size: [Math.max(b.width, 0), Math.max(b.height, 0)],
        insert: false,
      });
      break;
    }
    case "path":
      // Open paths are filled by implicitly closing them, so they enclose an
      // area for boolean ops too. ringToPath already closes the ring.
      if (shape.points.length < 3) return null;
      item = ringToPath(shape.points);
      break;
    case "bezier":
      item = compound(
        shape.subpaths
          .filter((sp) => sp.anchors.length >= 2)
          .map((sp) => {
            // Force the implicit fill close paper.js needs to see an area.
            const path = subpathToPath(sp);
            path.closed = true;
            return path;
          })
      );
      break;
    case "polygon":
      item = compound(
        shape.polys
          .flat()
          .filter((ring) => ring.length >= 3)
          .map(ringToPath)
      );
      // Polygons render with the even-odd rule (ring winding is arbitrary),
      // so boolean ops must read them the same way.
      if (item) item.fillRule = "evenodd";
      break;
    case "compoundPath":
      item = compound(
        shape.components
          .flatMap((component) => pathsOf(shapeToGeom(component)))
      );
      if (item) item.fillRule = "evenodd";
      break;
    case "line":
    case "image":
    case "text":
      return null;
  }
  if (!item) return null;
  item.transform(toPaperMatrix(shape.transform));
  return item;
}

/** Whether a shape encloses an area and can take part in boolean operations. */
export function isAreal(shape: Shape): boolean {
  switch (shape.type) {
    case "rect":
    case "ellipse":
    case "polygon":
    case "compoundPath":
      return true;
    case "path":
      return shape.points.length >= 3;
    case "bezier":
      return shape.subpaths.some((sp) => sp.anchors.length >= 2);
    case "line":
    case "image":
    case "text":
      return false;
  }
}

const OP_NAME: Record<BoolOp, string> = {
  union: "Union",
  subtract: "Subtract",
  intersect: "Intersect",
  xor: "Exclude",
};

/** Convert a boolean result back into editable Bézier subpaths. */
function geomToSubpaths(item: paper.PathItem): BezierSubpath[] {
  const paths =
    item instanceof paper.CompoundPath
      ? (item.children as paper.Path[])
      : [item as paper.Path];
  const subpaths: BezierSubpath[] = [];
  for (const path of paths) {
    if (!(path instanceof paper.Path) || path.segments.length < 2) continue;
    const anchors = path.segments.map((seg) => {
      const p = { x: seg.point.x, y: seg.point.y };
      return {
        p,
        hIn: seg.handleIn.isZero()
          ? null
          : { x: p.x + seg.handleIn.x, y: p.y + seg.handleIn.y },
        hOut: seg.handleOut.isZero()
          ? null
          : { x: p.x + seg.handleOut.x, y: p.y + seg.handleOut.y },
      };
    });
    subpaths.push({ anchors, closed: true });
  }
  return subpaths;
}

/**
 * Combine areal shapes with a boolean operation, in document order. `subtract`
 * removes every later shape from the first (bottom-most). Curves are kept as
 * curves; the result is a (possibly compound) Bézier shape editable with the
 * node tool. Returns null if there are <2 areal inputs or the result is empty.
 */
export function booleanShapes(shapes: Shape[], op: BoolOp): BezierShape | null {
  ensurePaper();
  const geoms = shapes
    .map(shapeToGeom)
    .filter((g): g is paper.PathItem => g !== null);
  if (geoms.length < 2) return null;

  let result = geoms[0];
  for (let i = 1; i < geoms.length; i++) {
    const other = geoms[i];
    switch (op) {
      case "union":
        result = result.unite(other, { insert: false });
        break;
      case "intersect":
        result = result.intersect(other, { insert: false });
        break;
      case "xor":
        result = result.exclude(other, { insert: false });
        break;
      case "subtract":
        result = result.subtract(other, { insert: false });
        break;
    }
  }

  const subpaths = geomToSubpaths(result);
  if (subpaths.length === 0) return null;

  const base = shapes[0];
  return {
    id: makeId("bezier"),
    name: OP_NAME[op],
    type: "bezier",
    subpaths,
    fill: base.fill,
    stroke: base.stroke,
    strokeWidth: base.strokeWidth,
    ...strokeDetailFields(base),
    opacity: base.opacity,
    blendMode: base.blendMode,
    transform: [...IDENTITY],
    transformOrigin: null,
  };
}
