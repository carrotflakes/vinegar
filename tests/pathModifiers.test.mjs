import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let applyPathModifiers;
let modifiedSubpaths;
let resolvedSubpaths;
let isAreal;
let supportsStrokeAlignment;
let hitTestShape;
let exportSvg;
let shapeBounds;
let createEmptyDocument;
let parseDocument;
let serializeDocument;
let cubicPoint;
let flattenSubpath;
let flattenSubpathAdaptive;
let subpathSegments;
let selectionMenu;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ applyPathModifiers, modifiedSubpaths, resolvedSubpaths } =
    await server.ssrLoadModule("/src/model/path/pathModifiers.ts"));
  ({ isAreal } = await server.ssrLoadModule("/src/model/path/boolean.ts"));
  ({ supportsStrokeAlignment } =
    await server.ssrLoadModule("/src/model/stroke.ts"));
  ({ hitTestShape } =
    await server.ssrLoadModule("/src/model/geometry/hitTest.ts"));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
  ({ shapeBounds } =
    await server.ssrLoadModule("/src/model/geometry/bounds.ts"));
  ({ createEmptyDocument } =
    await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } =
    await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ cubicPoint, flattenSubpath, flattenSubpathAdaptive, subpathSegments } =
    await server.ssrLoadModule("/src/model/path/path.ts"));
  ({ selectionMenu } = await server.ssrLoadModule("/src/ui/menus.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

after(async () => server.close());

const path = (modifiers = [], patch = {}) => ({
  id: "path-1",
  name: "Path",
  type: "path",
  ...SHAPE_BASE,
  ...NODE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  fillRule: "nonzero",
  subpaths: [{
    closed: true,
    anchors: [
      { p: { x: 0, y: 0 }, hIn: null, hOut: null },
      { p: { x: 20, y: 0 }, hIn: null, hOut: null },
      { p: { x: 20, y: 10 }, hIn: null, hOut: null },
      { p: { x: 0, y: 10 }, hIn: null, hOut: null },
    ],
  }],
  modifiers,
  ...patch,
});

const ring = (x, y, width, height) => ({
  closed: true,
  anchors: [
    { p: { x, y }, hIn: null, hOut: null },
    { p: { x: x + width, y }, hIn: null, hOut: null },
    { p: { x: x + width, y: y + height }, hIn: null, hOut: null },
    { p: { x, y: y + height }, hIn: null, hOut: null },
  ],
});

function insideEvenOdd(subpaths, point) {
  let crossings = 0;
  for (const subpath of subpaths) {
    const points = subpath.anchors.map((anchor) => anchor.p);
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y > point.y) !== (b.y > point.y)) {
        const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (x > point.x) crossings++;
      }
    }
  }
  return crossings % 2 === 1;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1,
        ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
      ));
  return Math.hypot(
    point.x - start.x - t * dx,
    point.y - start.y - t * dy
  );
}

test("disabled modifiers are bypassed and enabled stages run in order", () => {
  const shape = path([
    { type: "reverse", enabled: false },
    { type: "reverse" },
  ]);
  const resolved = resolvedSubpaths(shape);
  assert.deepEqual(resolved[0].anchors.map((anchor) => anchor.p), [
    { x: 0, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert.notStrictEqual(resolved, shape.subpaths);
});

test("resolved geometry is cached by immutable path identity", () => {
  const shape = path([{ type: "reverse" }]);
  assert.strictEqual(resolvedSubpaths(shape), resolvedSubpaths(shape));
  assert.notStrictEqual(
    resolvedSubpaths({ ...shape }),
    resolvedSubpaths(shape)
  );
});

test("offset changes downstream bounds without overwriting base geometry", () => {
  const shape = path([{ type: "offset", distance: 5, join: "miter" }]);
  const before = structuredClone(shape.subpaths);
  assert.deepEqual(shapeBounds(shape), { x: -5, y: -5, width: 30, height: 20 });
  assert.deepEqual(shape.subpaths, before);
});

test("adaptive flattening meets its error target on a large cubic", () => {
  const curved = {
    closed: false,
    anchors: [
      { p: { x: 0, y: 0 }, hIn: null, hOut: { x: 0, y: 1000 } },
      { p: { x: 1000, y: 0 }, hIn: { x: 1000, y: 1000 }, hOut: null },
    ],
  };
  const tolerance = 0.1;
  const points = flattenSubpathAdaptive(curved, tolerance);
  assert.ok(points.length > flattenSubpath(curved).length);
  const segment = subpathSegments(curved)[0];
  let maxError = 0;
  for (let i = 0; i <= 2000; i++) {
    const sample = cubicPoint(segment, i / 2000);
    const error = Math.min(
      ...points.slice(0, -1).map((point, index) =>
        distanceToSegment(sample, point, points[index + 1])
      )
    );
    maxError = Math.max(maxError, error);
  }
  assert.ok(maxError <= tolerance, `maximum flattening error was ${maxError}`);
});

test("evenodd offset recognizes a same-direction nested contour as a hole", () => {
  const shape = path(
    [{ type: "offset", distance: 5, join: "miter" }],
    { fillRule: "evenodd", subpaths: [ring(0, 0, 100, 100), ring(30, 30, 40, 40)] }
  );
  const resolved = resolvedSubpaths(shape);
  assert.equal(insideEvenOdd(resolved, { x: 50, y: 50 }), false);
  // Positive offset grows the filled band into the old hole.
  assert.equal(insideEvenOdd(resolved, { x: 32, y: 50 }), true);
  assert.deepEqual(shapeBounds(shape), { x: -5, y: -5, width: 110, height: 110 });
});

test("nonzero offset removes a redundant same-direction inner contour", () => {
  const shape = path(
    [{ type: "offset", distance: 5, join: "miter" }],
    { fillRule: "nonzero", subpaths: [ring(0, 0, 100, 100), ring(30, 30, 40, 40)] }
  );
  const resolved = resolvedSubpaths(shape);
  assert.equal(insideEvenOdd(resolved, { x: 50, y: 50 }), true);
  assert.equal(resolved.length, 1);
});

test("negative offset shrinks the outer contour and expands an evenodd hole", () => {
  const shape = path(
    [{ type: "offset", distance: -5, join: "miter" }],
    { fillRule: "evenodd", subpaths: [ring(0, 0, 100, 100), ring(30, 30, 40, 40)] }
  );
  const resolved = resolvedSubpaths(shape);
  assert.equal(insideEvenOdd(resolved, { x: 50, y: 50 }), false);
  assert.equal(insideEvenOdd(resolved, { x: 27, y: 50 }), false);
  assert.equal(insideEvenOdd(resolved, { x: 20, y: 50 }), true);
  assert.deepEqual(shapeBounds(shape), { x: 5, y: 5, width: 90, height: 90 });
});

test("offset preserves separate contours in one path", () => {
  const shape = path(
    [{ type: "offset", distance: 2, join: "miter" }],
    {
      fillRule: "evenodd",
      subpaths: [ring(0, 0, 10, 10), ring(30, 0, 10, 10)],
    }
  );
  const resolved = resolvedSubpaths(shape);
  assert.equal(resolved.length, 2);
  assert.equal(insideEvenOdd(resolved, { x: 5, y: 5 }), true);
  assert.equal(insideEvenOdd(resolved, { x: 35, y: 5 }), true);
  assert.equal(insideEvenOdd(resolved, { x: 20, y: 5 }), false);
  assert.deepEqual(shapeBounds(shape), { x: -2, y: -2, width: 44, height: 14 });
});

test("outline turns a closed contour into a centered band", () => {
  const shape = path(
    [{ type: "outline", width: 4, cap: "butt", join: "miter" }],
    { fillRule: "evenodd" }
  );
  const resolved = resolvedSubpaths(shape);
  assert.equal(insideEvenOdd(resolved, { x: 1, y: 5 }), true);
  assert.equal(insideEvenOdd(resolved, { x: 10, y: 5 }), false);
  assert.equal(insideEvenOdd(resolved, { x: -3, y: 5 }), false);
  assert.deepEqual(shapeBounds(shape), { x: -2, y: -2, width: 24, height: 14 });
});

test("outline applies caps to an open contour", () => {
  const shape = path(
    [{ type: "outline", width: 10, cap: "square", join: "round" }],
    {
      fillRule: "evenodd",
      subpaths: [{
        closed: false,
        anchors: [
          { p: { x: 0, y: 0 }, hIn: null, hOut: null },
          { p: { x: 20, y: 0 }, hIn: null, hOut: null },
        ],
      }],
    }
  );
  assert.deepEqual(shapeBounds(shape), { x: -5, y: -5, width: 30, height: 10 });
});

test("apply bakes resolved geometry, clears the stack, and detaches generator", () => {
  const shape = path([{ type: "reverse" }]);
  shape.generator = { scriptId: "star", args: { points: 5 } };
  const resolved = resolvedSubpaths(shape);
  const baked = applyPathModifiers(shape);
  assert.strictEqual(baked.subpaths, resolved);
  assert.deepEqual(baked.modifiers, []);
  assert.equal(baked.generator, null);
  assert.equal(shape.modifiers.length, 1);
});

test("modifier stacks round-trip in v33 documents", () => {
  const shape = path([
    { type: "simplify", tolerance: 1.25, enabled: false },
    { type: "offset", distance: -3, join: "bevel" },
    { type: "outline", width: 6, cap: "square", join: "miter" },
  ]);
  const empty = createEmptyDocument();
  const doc = {
    ...empty,
    rootIds: [shape.id],
    nodes: { [shape.id]: shape },
  };
  const text = serializeDocument(doc);
  assert.equal(JSON.parse(text).version, 33);
  assert.deepEqual(parseDocument(text).nodes[shape.id].modifiers, shape.modifiers);
});

const primitive = (type, patch, modifiers = []) => ({
  id: `${type}-1`,
  name: type,
  type,
  ...SHAPE_BASE,
  ...NODE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  modifiers,
  ...patch,
});

const rect = (modifiers = [], patch = {}) =>
  primitive("rect", { x: 0, y: 0, width: 20, height: 10, cornerRadius: 0, ...patch }, modifiers);
const ellipse = (modifiers = [], patch = {}) =>
  primitive("ellipse", { x: 0, y: 0, width: 20, height: 10, ...patch }, modifiers);
const line = (modifiers = [], patch = {}) =>
  primitive("line", { x1: 0, y1: 0, x2: 20, y2: 0, ...patch }, modifiers);

test("a rect resolves through its stack without losing its own fields", () => {
  const shape = rect([{ type: "offset", distance: 5, join: "miter" }]);
  assert.deepEqual(shapeBounds(shape), { x: -5, y: -5, width: 30, height: 20 });
  // The rect stays a rect: width, height and corner radius remain editable.
  assert.equal(shape.type, "rect");
  assert.equal(shape.width, 20);
});

test("a bare primitive keeps its own geometry and skips the subpath route", () => {
  assert.equal(modifiedSubpaths(rect()), null);
  assert.equal(modifiedSubpaths(ellipse([{ type: "reverse", enabled: false }])), null);
  assert.deepEqual(shapeBounds(rect()), { x: 0, y: 0, width: 20, height: 10 });
});

test("an outlined line becomes closed, areal and stroke-alignable", () => {
  const shape = line([{ type: "outline", width: 10, cap: "butt", join: "round" }]);
  const resolved = resolvedSubpaths(shape);
  assert.ok(resolved.length > 0);
  assert.ok(resolved.every((subpath) => subpath.closed));
  assert.equal(isAreal(shape), true);
  assert.equal(supportsStrokeAlignment(shape), true);
  assert.equal(supportsStrokeAlignment(line()), false);
  assert.deepEqual(shapeBounds(shape), { x: 0, y: -5, width: 20, height: 10 });
});

test("an ellipse's modified silhouette drives hit testing and SVG export", () => {
  const filled = { fill: { type: "solid", color: "#000000", alpha: 1 } };
  const shape = ellipse([{ type: "offset", distance: 10, join: "round" }], filled);
  const empty = createEmptyDocument();
  const doc = { ...empty, rootIds: [shape.id], nodes: { [shape.id]: shape } };
  // A point outside the bare ellipse but inside the offset silhouette.
  assert.equal(hitTestShape(doc, shape, { x: 10, y: 13 }, 0), true);
  assert.equal(hitTestShape(doc, ellipse([], filled), { x: 10, y: 13 }, 0), false);
  const svg = exportSvg(doc);
  assert.ok(!svg.includes("<ellipse"), svg);
  assert.ok(svg.includes("<path"), svg);
});

test("applying a stack converts a modified primitive into a path", () => {
  const shape = rect([{ type: "offset", distance: 5, join: "miter" }], {
    bindings: { "modifiers.0.distance": { paramId: "p1", scale: 1 } },
  });
  const empty = createEmptyDocument();
  const doc = { ...empty, rootIds: [shape.id], nodes: { [shape.id]: shape } };
  useEditor.getState().loadDocument(doc);
  useEditor.getState().setSelection([shape.id]);
  useEditor.getState().applyPathModifiersSelected();

  const baked = useEditor.getState().doc.nodes[shape.id];
  assert.equal(baked.type, "path");
  assert.deepEqual(baked.modifiers ?? [], []);
  assert.deepEqual(baked.bindings, {});
  assert.deepEqual(shapeBounds(baked), { x: -5, y: -5, width: 30, height: 20 });
});

test("primitive modifier stacks round-trip through the file format", () => {
  const shape = rect([{ type: "outline", width: 6, cap: "square", join: "miter" }]);
  const empty = createEmptyDocument();
  const text = serializeDocument({
    ...empty,
    rootIds: [shape.id],
    nodes: { [shape.id]: shape },
  });
  const parsed = parseDocument(text).nodes[shape.id];
  assert.equal(parsed.type, "rect");
  assert.deepEqual(parsed.modifiers, shape.modifiers);
});

test("selection context menu groups modifier commands in a submenu", () => {
  const shape = path();
  const empty = createEmptyDocument();
  useEditor.getState().loadDocument({
    ...empty,
    rootIds: [shape.id],
    nodes: { [shape.id]: shape },
  });
  useEditor.getState().setSelection([shape.id]);

  const pathMenu = selectionMenu().find(
    (entry) => entry !== "separator" && entry.label === "Path" && "submenu" in entry
  );
  assert.ok(pathMenu && "submenu" in pathMenu);
  const modifierMenu = pathMenu.submenu.find(
    (entry) => entry !== "separator" && entry.label === "Modifiers" && "submenu" in entry
  );
  assert.ok(modifierMenu && "submenu" in modifierMenu);
  assert.deepEqual(
    modifierMenu.submenu
      .filter((entry) => entry !== "separator")
      .map((entry) => entry.label),
    [
      "Add Simplify modifier",
      "Add Flatten modifier",
      "Add Offset modifier",
      "Add Outline modifier",
      "Add Smooth modifier",
      "Add Reverse modifier",
    ]
  );
  assert.equal(
    pathMenu.submenu.some(
      (entry) => entry !== "separator" && entry.label === "Add Simplify modifier"
    ),
    false
  );
});
