import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";

let server;
let canConvertShapeToPath;
let cachedBrushEnvelope;
let convertShapeToPath;
let createEmptyDocument;
let shapeBounds;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ canConvertShapeToPath, convertShapeToPath } =
    await server.ssrLoadModule("/src/model/convertToPath.ts"));
  ({ cachedBrushEnvelope } =
    await server.ssrLoadModule("/src/model/brushOutline.ts"));
  ({ createEmptyDocument } =
    await server.ssrLoadModule("/src/model/types.ts"));
  ({ shapeBounds } = await server.ssrLoadModule("/src/model/bounds.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

beforeEach(() => {
  useEditor.getState().newDocument();
});

after(async () => server.close());

const IDENTITY = [1, 0, 0, 1, 0, 0];
const solid = (color) => ({ type: "solid", color, alpha: 1 });

const appearance = (patch = {}) => ({
  fill: solid("#ff6633"),
  stroke: solid("#112233"),
  strokeWidth: 3,
  strokeDash: [4, 2],
  strokeDashOffset: 1,
  strokeCap: "square",
  strokeJoin: "bevel",
  strokeAlignment: "inside",
  opacity: 0.6,
  blendMode: "multiply",
  effects: [{ type: "blur", radius: 2 }],
  transform: [0, 1, -1, 0, 80, 30],
  transformOrigin: { x: 4, y: 5 },
  ...patch,
});

const rect = (id, patch = {}) => ({
  id,
  name: id,
  type: "rect",
  x: 10,
  y: 20,
  width: 80,
  height: 40,
  cornerRadius: 8,
  ...appearance(),
  ...patch,
});

const brush = (id, patch = {}) => ({
  id,
  name: id,
  type: "brush",
  anchors: [
    {
      p: { x: 0, y: 0 },
      hIn: null,
      hOut: { x: 15, y: -5 },
      w: 0.5,
    },
    {
      p: { x: 40, y: 20 },
      hIn: { x: 25, y: 25 },
      hOut: null,
      w: 1.5,
    },
  ],
  ...appearance({
    fill: solid("#abcdef"),
    stroke: solid("#8844ff"),
    strokeWidth: 12,
  }),
  ...patch,
});

test("rectangles, ellipses and lines convert to equivalent editable paths", () => {
  const doc = createEmptyDocument();
  const shapes = [
    rect("Rounded rectangle"),
    {
      ...rect("Ellipse"),
      type: "ellipse",
      x: -20,
      y: 5,
      width: 60,
      height: 30,
    },
    {
      ...rect("Line"),
      type: "line",
      x1: -4,
      y1: 8,
      x2: 30,
      y2: 42,
      fill: null,
      strokeAlignment: "center",
    },
  ];

  for (const shape of shapes) {
    assert.equal(canConvertShapeToPath(shape), true);
    const path = convertShapeToPath(shape, doc);
    assert.equal(path.type, "path");
    assert.equal(path.id, shape.id);
    assert.equal(path.name, shape.name);
    assert.deepEqual(shapeBounds(path), shapeBounds(shape));
    assert.deepEqual(path.transform, shape.transform);
    assert.deepEqual(path.transformOrigin, shape.transformOrigin);
    assert.deepEqual(path.fill, shape.fill);
    assert.deepEqual(path.stroke, shape.stroke);
    assert.deepEqual(path.effects, shape.effects);
  }

  const rectangle = convertShapeToPath(shapes[0], doc);
  assert.equal(rectangle.subpaths[0].closed, true);
  assert.equal(rectangle.subpaths[0].anchors.length, 8);

  const ellipse = convertShapeToPath(shapes[1], doc);
  assert.equal(ellipse.subpaths[0].closed, true);
  assert.equal(ellipse.subpaths[0].anchors.length, 4);
  assert.ok(ellipse.subpaths[0].anchors.every((anchor) =>
    anchor.hIn !== null && anchor.hOut !== null
  ));

  const line = convertShapeToPath(shapes[2], doc);
  assert.equal(line.subpaths[0].closed, false);
  assert.deepEqual(
    line.subpaths[0].anchors.map((anchor) => anchor.p),
    [{ x: -4, y: 8 }, { x: 30, y: 42 }]
  );
});

test("compound conversion bakes visible child transforms into even-odd subpaths", () => {
  const doc = createEmptyDocument();
  doc.nodes.rect = rect("rect", {
    x: 0,
    y: 0,
    width: 10,
    height: 20,
    cornerRadius: 0,
    transform: [1, 0, 0, 1, 30, 40],
  });
  doc.nodes.curve = {
    id: "curve",
    name: "curve",
    type: "path",
    subpaths: [{
      closed: true,
      anchors: [
        { p: { x: 0, y: 0 }, hIn: null, hOut: { x: 5, y: 0 } },
        { p: { x: 10, y: 0 }, hIn: { x: 5, y: 0 }, hOut: null },
        { p: { x: 10, y: 10 }, hIn: null, hOut: null },
      ],
    }],
    ...appearance({ transform: [2, 0, 0, 3, 7, 11] }),
  };
  doc.nodes.hidden = {
    ...rect("hidden"),
    hidden: true,
  };
  doc.nodes.compound = {
    id: "compound",
    name: "Logo cutout",
    type: "compoundPath",
    childIds: ["rect", "curve", "hidden"],
    ...appearance({ transform: [1, 0.2, -0.1, 1, 100, 50] }),
  };
  doc.rootIds = ["compound"];

  assert.equal(canConvertShapeToPath(doc.nodes.compound), true);
  const path = convertShapeToPath(doc.nodes.compound, doc);
  assert.equal(path.fillRule, "evenodd");
  assert.equal(path.subpaths.length, 2);
  assert.deepEqual(path.subpaths[0].anchors[0].p, { x: 30, y: 40 });
  assert.deepEqual(path.subpaths[1].anchors[0], {
    p: { x: 7, y: 11 },
    hIn: null,
    hOut: { x: 17, y: 11 },
  });
  assert.deepEqual(path.transform, doc.nodes.compound.transform);
  assert.deepEqual(path.effects, doc.nodes.compound.effects);
});

test("brush conversion expands the rendered envelope into a nonzero filled path", () => {
  const doc = createEmptyDocument();
  const source = brush("Pressure stroke");
  const ring = cachedBrushEnvelope(source);

  assert.equal(canConvertShapeToPath(source), true);
  assert.ok(ring.length > source.anchors.length);
  const path = convertShapeToPath(source, doc);

  assert.equal(path.fillRule, "nonzero");
  assert.deepEqual(path.fill, source.stroke);
  assert.equal(path.stroke, null);
  assert.equal(path.strokeWidth, 0);
  assert.equal(path.subpaths.length, 1);
  assert.equal(path.subpaths[0].closed, true);
  assert.deepEqual(
    path.subpaths[0].anchors.map((anchor) => anchor.p),
    ring
  );
  assert.ok(path.subpaths[0].anchors.every((anchor) =>
    anchor.hIn === null && anchor.hOut === null
  ));
  assert.deepEqual(shapeBounds(path), shapeBounds(source));
  assert.deepEqual(path.transform, source.transform);
  assert.deepEqual(path.effects, source.effects);
});

test("store conversion removes compound children in one undoable transaction", () => {
  const doc = createEmptyDocument();
  doc.nodes.a = rect("a", { transform: [...IDENTITY] });
  doc.nodes.b = rect("b", { x: 30, transform: [...IDENTITY] });
  doc.nodes.compound = {
    id: "compound",
    name: "compound",
    type: "compoundPath",
    childIds: ["a", "b"],
    ...appearance({ transform: [...IDENTITY] }),
  };
  doc.rootIds = ["compound"];

  useEditor.getState().loadDocument(doc);
  useEditor.getState().setSelection(["compound"]);
  const historyLength = useEditor.getState().history.past.length;
  useEditor.getState().convertSelectedToPaths();

  let state = useEditor.getState();
  assert.equal(state.history.past.length, historyLength + 1);
  assert.deepEqual(state.selection, ["compound"]);
  assert.deepEqual(state.doc.rootIds, ["compound"]);
  assert.equal(state.doc.nodes.compound.type, "path");
  assert.equal(state.doc.nodes.compound.fillRule, "evenodd");
  assert.equal(state.doc.nodes.a, undefined);
  assert.equal(state.doc.nodes.b, undefined);

  state.undo();
  state = useEditor.getState();
  assert.equal(state.doc.nodes.compound.type, "compoundPath");
  assert.ok(state.doc.nodes.a);
  assert.ok(state.doc.nodes.b);

  state.redo();
  state = useEditor.getState();
  assert.equal(state.doc.nodes.compound.type, "path");
  assert.equal(state.doc.nodes.a, undefined);
  assert.equal(state.doc.nodes.b, undefined);
});

test("store conversion replaces a brush in one undoable transaction", () => {
  const doc = createEmptyDocument();
  doc.nodes.brush = brush("brush");
  doc.rootIds = ["brush"];

  useEditor.getState().loadDocument(doc);
  useEditor.getState().setSelection(["brush"]);
  const historyLength = useEditor.getState().history.past.length;
  useEditor.getState().convertSelectedToPaths();

  let state = useEditor.getState();
  assert.equal(state.history.past.length, historyLength + 1);
  assert.deepEqual(state.selection, ["brush"]);
  assert.equal(state.doc.nodes.brush.type, "path");
  assert.deepEqual(state.doc.nodes.brush.fill, doc.nodes.brush.stroke);
  assert.equal(state.doc.nodes.brush.stroke, null);

  state.undo();
  state = useEditor.getState();
  assert.equal(state.doc.nodes.brush.type, "brush");
  assert.equal(state.doc.nodes.brush.strokeWidth, 12);

  state.redo();
  assert.equal(useEditor.getState().doc.nodes.brush.type, "path");
});
