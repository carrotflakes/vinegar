import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let parseDocument;
let serializeDocument;
let nodeWorldBounds;
let hitTestShape;
let parentIdOf;
let createDemoDocument;
let useEditor;
let nodeWorldMatrix;
let booleanShapes;
let exportSvg;
let canMakeCompoundPathSelection;
let paintShape;
let commands;
let matchKeydown;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } = await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ nodeWorldBounds } = await server.ssrLoadModule("/src/model/bounds.ts"));
  ({ hitTestShape } = await server.ssrLoadModule("/src/model/hitTest.ts"));
  ({ parentIdOf } = await server.ssrLoadModule("/src/model/scene.ts"));
  ({ createDemoDocument } = await server.ssrLoadModule("/src/demo/createDemoDocument.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ nodeWorldMatrix } = await server.ssrLoadModule("/src/model/matrix.ts"));
  ({ booleanShapes } = await server.ssrLoadModule("/src/model/boolean.ts"));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
  ({ canMakeCompoundPathSelection } = await server.ssrLoadModule("/src/model/compoundPath.ts"));
  ({ paintShape } = await server.ssrLoadModule("/src/canvas/render.ts"));
  ({ COMMANDS: commands, matchKeydown } =
    await server.ssrLoadModule("/src/commands/registry.ts"));
});

after(async () => server.close());

test("the shared Delete command removes a selected artboard", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.addArtboard({ x: 100, y: 100 });

  const selectedId = useEditor.getState().selectedArtboardId;
  const deleteCommand = commands.find((command) => command.id === "edit.delete");
  assert.ok(selectedId);
  assert.ok(deleteCommand);
  assert.equal(deleteCommand.enabled(useEditor.getState()), true);

  deleteCommand.run(useEditor.getState());
  assert.equal(useEditor.getState().doc.artboards.length, 0);
  assert.equal(useEditor.getState().selectedArtboardId, null);

  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.artboards[0].id, selectedId);
});

test("fit commands frame content, selection, and the selected artboard", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector: () => ({
      getBoundingClientRect: () => ({ width: 1000, height: 600 }),
    }),
  };

  try {
    const editor = useEditor.getState();
    editor.newDocument();
    const style = {
      name: "rect",
      type: "rect",
      fill: { type: "solid", color: "#ffffff", alpha: 1 },
      stroke: null,
      strokeWidth: 0,
      opacity: 1,
      transform: [1, 0, 0, 1, 0, 0],
      transformOrigin: null,
    };
    editor.addShape({ ...style, id: "left", x: 0, y: 0, width: 100, height: 100 });
    useEditor.getState().addShape({
      ...style,
      id: "right",
      x: 900,
      y: 0,
      width: 100,
      height: 100,
    });

    const fitAll = commands.find((command) => command.id === "view.fitAll");
    const fitSelection = commands.find(
      (command) => command.id === "view.fitSelection"
    );
    const fitArtboard = commands.find(
      (command) => command.id === "view.fitArtboard"
    );
    assert.ok(fitAll && fitSelection && fitArtboard);

    fitAll.run(useEditor.getState());
    assert.equal(useEditor.getState().viewport.scale, 0.904);

    // addShape selects the newly-created right rectangle.
    fitSelection.run(useEditor.getState());
    assert.equal(useEditor.getState().viewport.scale, 5.04);
    assert.deepEqual(useEditor.getState().viewport.offset, { x: -4288, y: 48 });

    useEditor.getState().addArtboard({ x: 500, y: 300 });
    assert.equal(fitArtboard.enabled(useEditor.getState()), true);
    fitArtboard.run(useEditor.getState());
    assert.equal(useEditor.getState().viewport.scale, 504 / 1080);
    assert.deepEqual(useEditor.getState().viewport.offset, {
      x: 500 - 500 * (504 / 1080),
      y: 300 - 300 * (504 / 1080),
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("Shift+number shortcuts match their physical digit keys", () => {
  const match = matchKeydown({
    key: "!",
    code: "Digit1",
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    altKey: false,
  });
  assert.equal(match?.cmd.id, "view.fitAll");
});

test("a nested v8 scene tree survives save/load and remains usable", () => {
  const doc = createEmptyDocument();
  doc.nodes.empty = {
    id: "empty", type: "group", name: "Empty", childIds: [], opacity: 1,
    transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
  };
  doc.nodes.outer = {
    id: "outer", type: "group", name: "Outer", childIds: ["rect", "inner"], opacity: 0.8,
    transform: [1, 0, 0, 1, 100, 50], transformOrigin: { x: 15, y: 25 },
  };
  doc.nodes.inner = {
    id: "inner", type: "group", name: "Inner", childIds: ["ellipse"], opacity: 1,
    transform: [1, 0, 0, 1, 10, 5], transformOrigin: null,
  };
  doc.nodes.rect = {
    id: "rect", type: "rect", name: "Rectangle",
    x: 10, y: 20, width: 30, height: 40,
    transform: [2, 0, 0, 2, 0, 0], transformOrigin: { x: 12, y: 22 },
    fill: { type: "solid", color: "#123456", alpha: 1 },
    stroke: { type: "solid", color: "#000000", alpha: 1 },
    strokeWidth: 2, opacity: 0.9,
  };
  doc.nodes.ellipse = {
    id: "ellipse", type: "ellipse", name: "Ellipse",
    x: 0, y: 0, width: 20, height: 10,
    transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
    fill: { type: "solid", color: "#abcdef", alpha: 1 },
    stroke: null, strokeWidth: 0, opacity: 1,
  };
  doc.rootIds = ["empty", "outer"];
  doc.settings.gridSize = 24;

  const loaded = parseDocument(serializeDocument(doc));
  assert.deepEqual(loaded.rootIds, ["empty", "outer"]);
  assert.deepEqual(loaded.nodes.outer.childIds, ["rect", "inner"]);
  assert.deepEqual(loaded.nodes.empty.childIds, []);
  assert.equal(parentIdOf(loaded, "ellipse"), "inner");
  assert.deepEqual(nodeWorldBounds(loaded, "rect"), { x: 120, y: 90, width: 60, height: 80 });
  assert.deepEqual(nodeWorldBounds(loaded, "ellipse"), { x: 110, y: 55, width: 20, height: 10 });
  assert.equal(hitTestShape(loaded, loaded.nodes.ellipse, { x: 120, y: 60 }, 1), true);

  const malformed = JSON.parse(serializeDocument(doc));
  malformed.document.rootIds.push("rect");
  assert.throws(() => parseDocument(JSON.stringify(malformed)), /multiple parents/);
  malformed.version = 5;
  assert.throws(() => parseDocument(JSON.stringify(malformed)), /Unsupported/);

  const demo = parseDocument(serializeDocument(createDemoDocument()));
  assert.deepEqual(
    new Set(Object.values(demo.nodes).map((node) => node.type)),
    new Set(["group", "rect", "ellipse", "line", "path", "compoundPath", "text"])
  );
  const demoCompound = demo.nodes.demo_compound_path;
  assert.equal(demoCompound.type, "compoundPath");
  assert.deepEqual(demoCompound.components.map((component) => component.type), ["path", "ellipse"]);
  assert.equal(hitTestShape(demo, demoCompound, { x: 690, y: 270 }, 0), true);
  assert.equal(hitTestShape(demo, demoCompound, { x: 773, y: 309 }, 0), false);
  assert.ok(Object.values(demo.nodes).some((node) => node.type === "group" && node.childIds.length === 0));

  const editor = useEditor.getState();
  editor.loadDocument(demo);
  const beforeMove = nodeWorldMatrix(demo, "demo_skew_rect");
  useEditor.getState().moveNode("demo_skew_rect", "demo_card_paths", 1);
  const moved = useEditor.getState().doc;
  assert.equal(parentIdOf(moved, "demo_skew_rect"), "demo_card_paths");
  nodeWorldMatrix(moved, "demo_skew_rect").forEach((value, i) =>
    assert.ok(Math.abs(value - beforeMove[i]) < 1e-9)
  );
  useEditor.getState().moveNode("demo_cards", "demo_card_paths", 0);
  assert.equal(parentIdOf(useEditor.getState().doc, "demo_cards"), null);
  useEditor.getState().undo();
  assert.equal(parentIdOf(useEditor.getState().doc, "demo_skew_rect"), "demo_card_shapes");
});

test("v20 path, bezier, polygon, and compound components migrate to unified paths", () => {
  const file = JSON.parse(serializeDocument(createEmptyDocument()));
  file.version = 20;
  const base = {
    name: "legacy",
    fill: { type: "solid", color: "#123456", alpha: 1 },
    stroke: null,
    strokeWidth: 0,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
  };
  const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 10 }];
  const anchors = points.map((p) => ({ p, hIn: null, hOut: null }));
  const legacyPath = {
    ...base,
    id: "polyline",
    type: "path",
    points,
    closed: false,
  };
  const legacyBezier = {
    ...base,
    id: "curve",
    type: "bezier",
    subpaths: [{ anchors, closed: true }],
  };
  const legacyPolygon = {
    ...base,
    id: "region",
    type: "polygon",
    polys: [[points, points.map((p) => ({ x: p.x + 3, y: p.y + 3 }))]],
  };
  const compound = {
    ...base,
    id: "compound",
    type: "compoundPath",
    fillRule: "evenodd",
    components: [
      { ...legacyPath, id: "component-path", closed: true },
      { ...legacyBezier, id: "component-bezier" },
      { ...legacyPolygon, id: "component-polygon" },
    ],
  };
  file.document.nodes = {
    polyline: legacyPath,
    curve: legacyBezier,
    region: legacyPolygon,
    compound,
  };
  file.document.rootIds = ["polyline", "curve", "region", "compound"];

  const loaded = parseDocument(JSON.stringify(file));
  assert.equal(loaded.nodes.polyline.type, "path");
  assert.equal(loaded.nodes.polyline.fillRule, undefined);
  assert.equal(loaded.nodes.polyline.subpaths[0].closed, false);
  assert.deepEqual(loaded.nodes.polyline.subpaths[0].anchors, anchors);

  assert.equal(loaded.nodes.curve.type, "path");
  assert.deepEqual(loaded.nodes.curve.subpaths, legacyBezier.subpaths);

  assert.equal(loaded.nodes.region.type, "path");
  assert.equal(loaded.nodes.region.fillRule, "evenodd");
  assert.equal(loaded.nodes.region.subpaths.length, 2);
  assert.ok(loaded.nodes.region.subpaths.every((subpath) => subpath.closed));

  const migratedCompound = loaded.nodes.compound;
  assert.equal(migratedCompound.type, "compoundPath");
  assert.deepEqual(
    migratedCompound.components.map((component) => component.type),
    ["path", "path", "path"]
  );
  assert.equal(migratedCompound.components[2].fillRule, "evenodd");
  assert.equal(JSON.parse(serializeDocument(loaded)).version, 21);
});

test("boolean ops keep curves and produce editable multi-subpath paths", () => {
  const style = {
    name: "e", fill: { type: "solid", color: "#ffffff", alpha: 1 },
    stroke: null, strokeWidth: 0, opacity: 1,
    transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
  };
  const outer = { id: "a", type: "ellipse", x: 0, y: 0, width: 100, height: 100, ...style };
  const inner = { id: "b", type: "ellipse", x: 30, y: 30, width: 40, height: 40, ...style };

  // Subtracting a fully contained ellipse cuts a hole: two closed subpaths.
  const ring = booleanShapes([outer, inner], "subtract");
  assert.equal(ring.type, "path");
  assert.equal(ring.subpaths.length, 2);
  assert.ok(ring.subpaths.every((sp) => sp.closed));
  // Curves survive as Bézier handles instead of being flattened to polylines.
  for (const sp of ring.subpaths) {
    assert.ok(sp.anchors.length <= 8, `expected few anchors, got ${sp.anchors.length}`);
    assert.ok(sp.anchors.some((an) => an.hIn || an.hOut));
  }

  // The hole is hit-test transparent; the ring itself is solid.
  const doc = createEmptyDocument();
  doc.nodes[ring.id] = ring;
  doc.rootIds = [ring.id];
  assert.equal(hitTestShape(doc, ring, { x: 50, y: 50 }, 0), false);
  assert.equal(hitTestShape(doc, ring, { x: 50, y: 15 }, 0), true);

  const shifted = { ...inner, id: "c", x: 70, y: 30 };
  const union = booleanShapes([outer, shifted], "union");
  assert.equal(union.subpaths.length, 1);
  assert.ok(union.subpaths[0].anchors.some((an) => an.hIn || an.hOut));
});

test("compound paths retain source shapes, cut even-odd holes, and release", () => {
  const doc = createEmptyDocument();
  const base = {
    name: "base", fill: { type: "solid", color: "#123456", alpha: 1 },
    stroke: { type: "solid", color: "#222222", alpha: 1 }, strokeWidth: 2,
    opacity: 0.8, transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
  };
  doc.nodes.outer = {
    id: "outer", type: "rect", x: 0, y: 0, width: 100, height: 100, ...base,
  };
  doc.nodes.inner = {
    id: "inner", type: "ellipse", x: 25, y: 25, width: 50, height: 50,
    ...base, name: "cutter", fill: { type: "solid", color: "#ff0000", alpha: 1 },
    transform: [1, 0, 0, 1, 5, 0],
  };
  doc.rootIds = ["outer", "inner"];

  assert.equal(canMakeCompoundPathSelection(doc, ["outer", "inner"]), true);
  const editor = useEditor.getState();
  editor.loadDocument(doc);
  useEditor.getState().setSelection(["outer", "inner"]);
  useEditor.getState().makeCompoundPathSelected();

  let state = useEditor.getState();
  assert.equal(state.doc.rootIds.length, 1);
  const compoundId = state.doc.rootIds[0];
  let compound = state.doc.nodes[compoundId];
  assert.equal(compound.type, "compoundPath");
  assert.deepEqual(compound.components.map((component) => component.type), ["rect", "ellipse"]);
  assert.deepEqual(compound.fill, { type: "solid", color: "#123456", alpha: 1 });
  assert.equal("subpaths" in compound, false);
  assert.equal(hitTestShape(state.doc, compound, { x: 10, y: 10 }, 0), true);
  assert.equal(hitTestShape(state.doc, compound, { x: 55, y: 50 }, 0), false);
  const drawCalls = [];
  const mockContext = {
    save() {}, restore() {}, transform() {}, beginPath() {}, closePath() {},
    rect() {}, lineTo() {}, bezierCurveTo() {}, fill() {}, stroke() {},
    moveTo(x, y) { drawCalls.push(["moveTo", x, y]); },
    ellipse() { drawCalls.push(["ellipse"]); },
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1,
    lineJoin: "round", lineCap: "round", globalCompositeOperation: "source-over",
  };
  paintShape(mockContext, compound);
  const ellipseCall = drawCalls.findIndex(([name]) => name === "ellipse");
  assert.ok(ellipseCall > 0);
  assert.equal(drawCalls[ellipseCall - 1][0], "moveTo");
  const svg = exportSvg(state.doc, 0);
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, / C /); // retained ellipse is exported as cubic geometry

  const loaded = parseDocument(serializeDocument(state.doc));
  assert.equal(loaded.nodes[compoundId].type, "compoundPath");
  assert.equal(loaded.nodes[compoundId].components[1].type, "ellipse");
  const malformedCompound = JSON.parse(serializeDocument(state.doc));
  malformedCompound.document.nodes[compoundId].components[0].type = "line";
  assert.throws(
    () => parseDocument(JSON.stringify(malformedCompound)),
    /missing or malformed/
  );

  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.rootIds, ["outer", "inner"]);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes[compoundId].type, "compoundPath");
  useEditor.getState().setSelection([compoundId]);

  useEditor.getState().updateSelectedStyle({
    fill: { type: "solid", color: "#abcdef", alpha: 1 },
    transform: [1, 0, 0, 1, 10, 5],
  });
  useEditor.getState().releaseCompoundPathSelected();
  state = useEditor.getState();
  assert.equal(state.doc.rootIds.length, 2);
  assert.deepEqual(state.doc.rootIds, state.selection);
  const released = state.doc.rootIds.map((id) => state.doc.nodes[id]);
  assert.deepEqual(released.map((shape) => shape.type), ["rect", "ellipse"]);
  assert.ok(released.every((shape) =>
    shape.fill?.type === "solid" && shape.fill.color === "#abcdef"
  ));
  assert.deepEqual(
    released.map((shape) => [shape.transform[4], shape.transform[5]]),
    [[10, 5], [15, 5]]
  );
  assert.ok(released.every((shape) => shape.id !== "outer" && shape.id !== "inner"));

  useEditor.getState().undo();
  compound = useEditor.getState().doc.nodes[compoundId];
  assert.equal(compound.type, "compoundPath");
  assert.deepEqual(compound.fill, { type: "solid", color: "#abcdef", alpha: 1 });
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.rootIds.length, 2);

  const openDoc = createEmptyDocument();
  openDoc.nodes.a = { ...doc.nodes.outer, id: "a" };
  openDoc.nodes.b = {
    id: "b", type: "path", name: "open",
    subpaths: [{
      anchors: [
        { p: { x: 0, y: 0 }, hIn: null, hOut: null },
        { p: { x: 5, y: 5 }, hIn: null, hOut: null },
      ],
      closed: false,
    }],
    ...base,
  };
  openDoc.rootIds = ["a", "b"];
  assert.equal(canMakeCompoundPathSelection(openDoc, ["a", "b"]), false);
});
