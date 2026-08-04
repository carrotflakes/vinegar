import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let applyPathModifiers;
let arrayCopyCount;
let MAX_ARRAY_COPIES;
let resolvedSubpaths;
let writeNumField;
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
  ({ applyPathModifiers, arrayCopyCount, MAX_ARRAY_COPIES, resolvedSubpaths } =
    await server.ssrLoadModule("/src/model/path/pathModifiers.ts"));
  ({ writeNumField } = await server.ssrLoadModule("/src/model/params.ts"));
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

test("modifier stacks round-trip in v36 documents", () => {
  const shape = path([
    { type: "simplify", tolerance: 1.25, enabled: false },
    { type: "offset", distance: -3, join: "bevel" },
    { type: "outline", width: 6, cap: "square", join: "miter" },
    { type: "array", count: 4, dx: 30, dy: -2 },
    { type: "radial", count: 3, angle: 180, cx: 10, cy: 60, rotateCopies: false },
  ]);
  const empty = createEmptyDocument();
  const doc = {
    ...empty,
    rootIds: [shape.id],
    nodes: { [shape.id]: shape },
  };
  const text = serializeDocument(doc);
  assert.equal(JSON.parse(text).version, 36);
  assert.deepEqual(parseDocument(text).nodes[shape.id].modifiers, shape.modifiers);
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
      "Add Array modifier",
      "Add Radial modifier",
    ]
  );
  assert.equal(
    pathMenu.submenu.some(
      (entry) => entry !== "separator" && entry.label === "Add Simplify modifier"
    ),
    false
  );
});

test("array repeats the input along its step, leaving the first copy in place", () => {
  const shape = path([{ type: "array", count: 3, dx: 30, dy: 5 }]);
  const resolved = resolvedSubpaths(shape);
  assert.equal(resolved.length, 3);
  // The first copy is the input itself, untouched.
  assert.deepEqual(resolved[0], shape.subpaths[0]);
  assert.deepEqual(
    resolved[2].anchors.map((anchor) => anchor.p),
    shape.subpaths[0].anchors.map((anchor) => ({
      x: anchor.p.x + 60,
      y: anchor.p.y + 10,
    }))
  );
  assert.deepEqual(shapeBounds(shape), { x: 0, y: 0, width: 80, height: 20 });
});

test("a single copy is a pass-through that keeps the input array identity", () => {
  const shape = path([{ type: "array", count: 1, dx: 30, dy: 0 }]);
  assert.strictEqual(resolvedSubpaths(shape), shape.subpaths);
});

test("radial divides the whole sweep by the count", () => {
  // Four copies over a full turn: the third is the input rotated a half turn
  // about the pivot, so it lands point-symmetrically opposite.
  const shape = path([
    { type: "radial", count: 4, angle: 360, cx: 10, cy: 50, rotateCopies: true },
  ]);
  const resolved = resolvedSubpaths(shape);
  assert.equal(resolved.length, 4);
  const opposite = resolved[2].anchors.map((anchor) => anchor.p);
  shape.subpaths[0].anchors.forEach((anchor, i) => {
    assert.ok(Math.abs(opposite[i].x - (20 - anchor.p.x)) < 1e-9);
    assert.ok(Math.abs(opposite[i].y - (100 - anchor.p.y)) < 1e-9);
  });
});

test("radial copies keep their orientation when rotateCopies is off", () => {
  const turned = path([
    { type: "radial", count: 4, angle: 360, cx: 10, cy: 50, rotateCopies: true },
  ]);
  const upright = path([
    { type: "radial", count: 4, angle: 360, cx: 10, cy: 50, rotateCopies: false },
  ]);
  const quarter = resolvedSubpaths(upright)[1].anchors.map((a) => a.p);
  // The copy is translated only: every edge keeps its original vector.
  const base = upright.subpaths[0].anchors.map((a) => a.p);
  const dx = quarter[0].x - base[0].x;
  const dy = quarter[0].y - base[0].y;
  base.forEach((point, i) => {
    assert.ok(Math.abs(quarter[i].x - (point.x + dx)) < 1e-9);
    assert.ok(Math.abs(quarter[i].y - (point.y + dy)) < 1e-9);
  });
  // …which the rotating variant does not do.
  const rotated = resolvedSubpaths(turned)[1].anchors.map((a) => a.p);
  assert.ok(Math.abs(rotated[1].y - rotated[0].y) > 1e-6);
});

test("a copy count is made whole and bounded, however it is written", () => {
  assert.equal(arrayCopyCount(2.6), 3);
  assert.equal(arrayCopyCount(0), 1);
  assert.equal(arrayCopyCount(1e9), MAX_ARRAY_COPIES);
  assert.equal(arrayCopyCount(Number.NaN), 1);
  assert.equal(resolvedSubpaths(path([{ type: "array", count: 2.6, dx: 5, dy: 0 }])).length, 3);
  // A bound count comes from a variable that knows nothing about the field.
  const shape = path([{ type: "array", count: 3, dx: 5, dy: 0 }]);
  const written = writeNumField(shape, "modifiers.0.count", 4.7);
  assert.equal(written.modifiers[0].count, 5);
  assert.equal(writeNumField(shape, "modifiers.0.count", -3).modifiers[0].count, 1);
  assert.equal(writeNumField(shape, "modifiers.0.dx", -3).modifiers[0].dx, -3);
});

test("a fresh repeating stage is placed relative to the shape it was added to", () => {
  const shape = path();
  const empty = createEmptyDocument();
  useEditor.getState().loadDocument({
    ...empty,
    rootIds: [shape.id],
    nodes: { [shape.id]: shape },
  });
  useEditor.getState().setSelection([shape.id]);
  useEditor.getState().addPathModifierSelected("array");
  useEditor.getState().addPathModifierSelected("radial");

  const [array, radial] = useEditor.getState().doc.nodes[shape.id].modifiers;
  // The shape spans 20x10 from the origin: a step wider than it, and a pivot
  // below it, so both stages show a repetition the moment they are added.
  assert.equal(array.dx, 24);
  assert.equal(array.dy, 0);
  assert.ok(array.count > 1);
  assert.equal(radial.cx, 10);
  assert.equal(radial.cy, 20);
  assert.equal(radial.rotateCopies, true);
  assert.equal(resolvedSubpaths(useEditor.getState().doc.nodes[shape.id]).length, 18);
});
