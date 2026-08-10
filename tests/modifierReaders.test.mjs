// Guards for the one convention the modifier stack rests on: every reader that
// branches on a primitive's shape type has to consult the resolved geometry
// first, or that shape silently ignores its modifiers. See
// docs/path-modifiers.md.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let baseSubpaths;
let shapeBounds;
let hitTestShape;
let isAreal;
let supportsStrokeAlignment;
let strokeOutline;
let exportSvg;
let createEmptyDocument;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ baseSubpaths } = await server.ssrLoadModule("/src/model/path/pathModifiers.ts"));
  ({ shapeBounds } = await server.ssrLoadModule("/src/model/geometry/bounds.ts"));
  ({ hitTestShape } = await server.ssrLoadModule("/src/model/geometry/hitTest.ts"));
  ({ isAreal } = await server.ssrLoadModule("/src/model/path/boolean.ts"));
  ({ supportsStrokeAlignment } = await server.ssrLoadModule("/src/model/stroke.ts"));
  ({ strokeOutline } = await server.ssrLoadModule("/src/model/path/outlineStroke.ts"));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
});

after(async () => server.close());

// ---------------------------------------------------------------------------
// 1. Every type-branching file is either a geometry reader (must resolve) or a
//    listed non-reader.
// ---------------------------------------------------------------------------

/**
 * Files that branch on `rect`/`ellipse`/`line` for something other than
 * reading painted geometry. Each entry states why resolving would be wrong.
 */
const NON_READERS = {
  "src/canvas/toolDispatch.ts": "branches on the active tool id, not a shape",
  "src/canvas/tools/shapeTools.ts": "authors base fields while drawing/editing",
  "src/io/serialize.ts": "validates the persisted base fields",
  "src/model/geometry/transforms.ts": "writes base fields under a transform",
  "src/model/path/convertToPath.ts": "builds the base of a converted path",
  "src/model/path/pathModifiers.ts": "defines the base geometry itself",
  "src/script/runScript.ts": "constructs shapes from script output",
  "src/ui/panels/properties/SelectionHeader.tsx": "labels the selection",
};

/** Any of these means the file consults resolved geometry before branching. */
const RESOLVES = /modifiedSubpaths|resolvedSubpaths|hasActiveModifiers/;
const BRANCHES = /case "(rect|ellipse|line)":|type === "(rect|ellipse|line)"/;

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".css.ts")) out.push(path);
  }
  return out;
}

test("every shape-type-branching reader consults resolved geometry", () => {
  const offenders = [];
  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    if (!BRANCHES.test(source)) continue;
    if (NON_READERS[file] || RESOLVES.test(source)) continue;
    offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    "these files branch on rect/ellipse/line without resolving modifiers " +
      "first — add the modifiedSubpaths guard, or list the file in " +
      "NON_READERS with the reason it authors base geometry instead"
  );
});

test("the non-reader list has no stale entries", () => {
  for (const [file, reason] of Object.entries(NON_READERS)) {
    assert.ok(
      BRANCHES.test(readFileSync(file, "utf8")),
      `${file} no longer branches on a primitive type (${reason})`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. The invariant the guard exists to uphold: a modified primitive behaves
//    exactly like the path holding the same base contours and the same stack.
// ---------------------------------------------------------------------------

const shapeBase = (id, type, patch, modifiers) => ({
  id,
  name: type,
  type,
  ...SHAPE_BASE,
  ...NODE_BASE,
  fill: { type: "solid", color: "#000000", alpha: 1 },
  stroke: { type: "solid", color: "#ff0000", alpha: 1 },
  strokeWidth: 2,
  transform: [1, 0, 0, 1, 0, 0],
  modifiers,
  ...patch,
});

/** The plain path a primitive must be indistinguishable from. */
const equivalentPath = (shape) => ({
  ...shapeBase(shape.id, "path", {}, shape.modifiers),
  fillRule: "nonzero",
  subpaths: baseSubpaths({ ...shape, modifiers: [] }),
});

const docOf = (shape) => {
  const empty = createEmptyDocument();
  return { ...empty, rootIds: [shape.id], nodes: { [shape.id]: shape } };
};

const svgGeometry = (shape) =>
  exportSvg(docOf(shape)).match(/ d="[^"]*"/g) ?? [];

const STACKS = [
  [{ type: "offset", distance: 6, join: "round" }],
  [{ type: "outline", width: 5, cap: "square", join: "miter" }],
  [{ type: "reverse" }, { type: "flatten", tolerance: 0.5 }],
];

const PRIMITIVES = {
  rect: { x: 0, y: 0, width: 40, height: 24, cornerRadius: 6 },
  ellipse: { x: 0, y: 0, width: 40, height: 24 },
  line: { x1: 0, y1: 0, x2: 40, y2: 24 },
};

test("a fully disabled stack leaves the primitive's own fast path in place", () => {
  for (const [type, fields] of Object.entries(PRIMITIVES)) {
    const bypassed = shapeBase("shape-1", type, fields, [
      { type: "simplify", tolerance: 2.5, enabled: false },
    ]);
    const bare = shapeBase("shape-1", type, fields, []);
    assert.deepEqual(shapeBounds(bypassed), shapeBounds(bare), type);
    // Still emitted as <rect>/<ellipse>/<line>, not baked path data.
    assert.deepEqual(svgGeometry(bypassed), svgGeometry(bare), type);
  }
});

for (const [type, fields] of Object.entries(PRIMITIVES)) {
  for (const [index, modifiers] of STACKS.entries()) {
    test(`a modified ${type} reads like its equivalent path (stack ${index})`, () => {
      const shape = shapeBase("shape-1", type, fields, modifiers);
      const path = equivalentPath(shape);

      assert.deepEqual(shapeBounds(shape), shapeBounds(path), "bounds");
      assert.equal(isAreal(shape), isAreal(path), "isAreal");
      assert.equal(
        supportsStrokeAlignment(shape),
        supportsStrokeAlignment(path),
        "stroke alignment support"
      );
      assert.deepEqual(
        strokeOutline(shape, undefined, docOf(shape)),
        strokeOutline(path, undefined, docOf(path)),
        "outlined stroke"
      );
      assert.deepEqual(svgGeometry(shape), svgGeometry(path), "SVG geometry");

      const shapeDoc = docOf(shape);
      const pathDoc = docOf(path);
      const bounds = shapeBounds(shape);
      for (let i = 0; i <= 12; i++) {
        for (let j = 0; j <= 12; j++) {
          const p = {
            x: bounds.x - 4 + ((bounds.width + 8) * i) / 12,
            y: bounds.y - 4 + ((bounds.height + 8) * j) / 12,
          };
          assert.equal(
            hitTestShape(shapeDoc, shape, p, 1),
            hitTestShape(pathDoc, path, p, 1),
            `hit test at ${p.x},${p.y}`
          );
        }
      }
    });
  }
}
