import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let createEmptyDocument;
let parseDocument;
let serializeDocument;
let nodeWorldBounds;
let hitTestShape;
let parentIdOf;
let loadDemoDocument;
let GENERATORS;
let useEditor;
let nodeWorldMatrix;
let booleanShapes;
let exportSvg;
let canMakeCompoundPathSelection;
let paintShape;
let selectedNodeShapes;
let sceneIndex;
let useToasts;
let commands;
let matchKeydown;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } = await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ nodeWorldBounds } = await server.ssrLoadModule("/src/model/geometry/bounds.ts"));
  ({ hitTestShape } = await server.ssrLoadModule("/src/model/geometry/hitTest.ts"));
  ({ parentIdOf, sceneIndex } = await server.ssrLoadModule("/src/model/scene.ts"));
  ({ loadDemoDocument } = await server.ssrLoadModule("/src/demo/demoDocument.ts"));
  ({ GENERATORS } = await server.ssrLoadModule("/src/model/generators/generators.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ nodeWorldMatrix } = await server.ssrLoadModule("/src/model/geometry/matrix.ts"));
  ({ booleanShapes } = await server.ssrLoadModule("/src/model/path/boolean.ts"));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
  ({ canMakeCompoundPathSelection } = await server.ssrLoadModule("/src/model/path/compoundPath.ts"));
  ({ paintShape } = await server.ssrLoadModule("/src/canvas/render/scene.ts"));
  ({ selectedNodeShapes } = await server.ssrLoadModule("/src/canvas/picking.ts"));
  ({ useToasts } = await server.ssrLoadModule("/src/store/toastStore.ts"));
  ({ COMMANDS: commands, matchKeydown } =
    await server.ssrLoadModule("/src/commands/registry.ts"));
});

after(async () => server.close());

test("the shared Delete command removes a selected frame", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.addFrame({ x: 100, y: 100 });

  const selectedId = useEditor.getState().selection[0];
  const deleteCommand = commands.find((command) => command.id === "edit.delete");
  assert.ok(selectedId);
  assert.ok(deleteCommand);
  assert.equal(deleteCommand.enabled(useEditor.getState()), true);

  deleteCommand.run(useEditor.getState());
  assert.equal(useEditor.getState().doc.rootIds.length, 0);
  assert.equal(useEditor.getState().doc.nodes[selectedId], undefined);

  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.rootIds[0], selectedId);
});

test("fit commands frame content, selection, and the selected frame", () => {
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
      ...SHAPE_BASE, cornerRadius: 0,
      ...NODE_BASE,
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
    const fitFrame = commands.find(
      (command) => command.id === "view.fitFrame"
    );
    assert.ok(fitAll && fitSelection && fitFrame);

    fitAll.run(useEditor.getState());
    assert.equal(useEditor.getState().viewport.scale, 0.904);

    // addShape selects the newly-created right rectangle.
    fitSelection.run(useEditor.getState());
    assert.equal(useEditor.getState().viewport.scale, 5.04);
    assert.deepEqual(useEditor.getState().viewport.offset, { x: -4288, y: 48 });

    useEditor.getState().addFrame({ x: 500, y: 300 });
    assert.equal(fitFrame.enabled(useEditor.getState()), true);
    fitFrame.run(useEditor.getState());
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

test("tagged and legacy untagged anchors both survive save and load", () => {
  const doc = createEmptyDocument();
  doc.nodes.curve = {
    id: "curve",
    name: "Curve",
    type: "path",
    ...SHAPE_BASE,
    fillRule: "nonzero",
    ...NODE_BASE,
    subpaths: [{
      closed: false,
      anchors: [
        {
          p: { x: 0, y: 0 },
          hIn: { x: -5, y: 0 },
          hOut: { x: 10, y: 0 },
          t: "smooth",
        },
        {
          p: { x: 20, y: 0 },
          hIn: null,
          hOut: null,
        },
      ],
    }],
    transform: [1, 0, 0, 1, 0, 0],
  };
  doc.rootIds = ["curve"];

  const loaded = parseDocument(serializeDocument(doc));
  assert.equal(loaded.nodes.curve.subpaths[0].anchors[0].t, "smooth");
  assert.equal("t" in loaded.nodes.curve.subpaths[0].anchors[1], false);

  const legacy = JSON.parse(serializeDocument(doc));
  delete legacy.document.nodes.curve.subpaths[0].anchors[0].t;
  const loadedLegacy = parseDocument(JSON.stringify(legacy));
  assert.equal("t" in loadedLegacy.nodes.curve.subpaths[0].anchors[0], false);
});

test("a nested v8 scene tree survives save/load and remains usable", () => {
  const doc = createEmptyDocument();
  doc.nodes.empty = {
    id: "empty", type: "group", clipsToMask: false, ...NODE_BASE, name: "Empty", childIds: [], opacity: 1,
    transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
  };
  doc.nodes.outer = {
    id: "outer", type: "group", clipsToMask: false, ...NODE_BASE, name: "Outer", childIds: ["rect", "inner"], opacity: 0.8,
    transform: [1, 0, 0, 1, 100, 50], transformOrigin: { x: 15, y: 25 },
  };
  doc.nodes.inner = {
    id: "inner", type: "group", clipsToMask: false, ...NODE_BASE, name: "Inner", childIds: ["ellipse"], opacity: 1,
    transform: [1, 0, 0, 1, 10, 5], transformOrigin: null,
  };
  doc.nodes.rect = {
    id: "rect", type: "rect", ...SHAPE_BASE, cornerRadius: 0, ...NODE_BASE, name: "Rectangle",
    x: 10, y: 20, width: 30, height: 40,
    transform: [2, 0, 0, 2, 0, 0], transformOrigin: { x: 12, y: 22 },
    fill: { type: "solid", color: "#123456", alpha: 1 },
    stroke: { type: "solid", color: "#000000", alpha: 1 },
    strokeWidth: 2, opacity: 0.9,
  };
  doc.nodes.ellipse = {
    id: "ellipse", type: "ellipse", ...SHAPE_BASE, ...NODE_BASE, name: "Ellipse",
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
});

test("the bundled demo file loads, validates, and stays editable", async () => {
  // The bundled demo is a data file, so this is also its schema check: it has
  // to survive the same parse the app performs when the command opens it.
  const demo = parseDocument(serializeDocument(await loadDemoDocument()));
  assert.deepEqual(
    new Set(Object.values(demo.nodes).map((node) => node.type)),
    new Set(["frame", "group", "rect", "ellipse", "line", "path", "compoundPath",
      "image", "text", "brush", "instance"])
  );
  // Every generator link resolves to a built-in or to a document script, and
  // every swatch reference to a real global colour.
  for (const node of Object.values(demo.nodes)) {
    if (node.generator) {
      assert.ok(
        GENERATORS[node.generator.scriptId] || demo.scripts[node.generator.scriptId],
        `dangling generator ${node.generator.scriptId}`
      );
    }
    for (const paint of [node.fill, node.stroke]) {
      if (paint?.type === "swatch") assert.ok(demo.swatches[paint.swatchId]);
    }
  }
  const demoCompound = demo.nodes.struct_compound;
  assert.equal(demoCompound.type, "compoundPath");
  assert.deepEqual(
    demoCompound.childIds.map((id) => demo.nodes[id].type),
    ["path", "ellipse", "rect"]
  );
  assert.equal(parentIdOf(demo, "struct_compound_outer"), "struct_compound");
  // Inside the outer contour, but not inside either even-odd hole.
  assert.equal(hitTestShape(demo, demoCompound, { x: 680, y: 860 }, 0), true);
  assert.equal(hitTestShape(demo, demoCompound, { x: 733, y: 895 }, 0), false);
  assert.ok(Object.values(demo.nodes).some((node) => node.type === "group" && node.childIds.length === 0));

  const editor = useEditor.getState();
  editor.loadDocument(demo);
  useEditor.getState().setSelection(["struct_compound"]);
  // Only the compound's path child is node-editable; its rect/ellipse children
  // are not.
  assert.deepEqual(
    selectedNodeShapes(useEditor.getState()).map((shape) => shape.id),
    ["struct_compound_outer"]
  );
  const beforeMove = nodeWorldMatrix(demo, "struct_nested_a");
  useEditor.getState().moveNode("struct_nested_a", "struct_nested", 1);
  const moved = useEditor.getState().doc;
  assert.equal(parentIdOf(moved, "struct_nested_a"), "struct_nested");
  nodeWorldMatrix(moved, "struct_nested_a").forEach((value, i) =>
    assert.ok(Math.abs(value - beforeMove[i]) < 1e-9)
  );
  // Moving a group into its own descendant is rejected, so its parent (the
  // frame the demo authors it in) stays unchanged.
  useEditor.getState().moveNode("struct_nested", "struct_nested_inner", 0);
  assert.equal(parentIdOf(useEditor.getState().doc, "struct_nested"), "frame_structure");
  useEditor.getState().undo();
  assert.equal(parentIdOf(useEditor.getState().doc, "struct_nested_a"), "struct_nested_inner");
});

test("boolean ops keep curves and produce editable multi-subpath paths", () => {
  const style = {
    name: "e", fill: { type: "solid", color: "#ffffff", alpha: 1 },
    stroke: null, strokeWidth: 0, opacity: 1,
    transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
  };
  const outer = { id: "a", type: "ellipse", ...SHAPE_BASE, ...NODE_BASE, x: 0, y: 0, width: 100, height: 100, ...style };
  const inner = { id: "b", type: "ellipse", ...SHAPE_BASE, ...NODE_BASE, x: 30, y: 30, width: 40, height: 40, ...style };

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

test("compound paths own real children, cut even-odd holes, and release", () => {
  const doc = createEmptyDocument();
  const base = {
    name: "base", fill: { type: "solid", color: "#123456", alpha: 1 },
    stroke: { type: "solid", color: "#222222", alpha: 1 }, strokeWidth: 2,
    opacity: 0.8, transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
  };
  const outerEffects = [{ id: "fx_outer", type: "blur", radius: 1 }];
  doc.nodes.outer = {
    id: "outer", type: "rect", ...SHAPE_BASE, cornerRadius: 0, ...NODE_BASE, x: 0, y: 0, width: 100, height: 100, ...base,
    effects: outerEffects,
  };
  doc.nodes.inner = {
    id: "inner", type: "ellipse", ...SHAPE_BASE, ...NODE_BASE, x: 25, y: 25, width: 50, height: 50,
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
  assert.deepEqual(compound.childIds, ["outer", "inner"]);
  assert.deepEqual(
    compound.childIds.map((id) => state.doc.nodes[id].type),
    ["rect", "ellipse"]
  );
  assert.equal(parentIdOf(state.doc, "inner"), compoundId);
  assert.ok(sceneIndex(state.doc).shapeIds.includes(compoundId));
  assert.equal(sceneIndex(state.doc).shapeIds.includes("outer"), false);
  assert.deepEqual(compound.effects, outerEffects);
  useToasts.setState({ toasts: [] });
  useEditor.getState().moveNode(compoundId, compoundId, 0);
  assert.deepEqual(useEditor.getState().doc.rootIds, [compoundId]);
  assert.equal(useToasts.getState().toasts.at(-1)?.kind, "error");
  assert.match(
    useToasts.getState().toasts.at(-1)?.message ?? "",
    /Compound paths only accept/
  );
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.rootIds, ["outer", "inner"]);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes[compoundId].type, "compoundPath");
  useEditor.getState().setSelection([compoundId]);
  state = useEditor.getState();
  compound = state.doc.nodes[compoundId];
  assert.deepEqual(compound.fill, { type: "solid", color: "#123456", alpha: 1 });
  assert.equal("subpaths" in compound, false);
  assert.equal(hitTestShape(state.doc, compound, { x: 10, y: 10 }, 0), true);
  assert.equal(hitTestShape(state.doc, compound, { x: 55, y: 50 }, 0), false);
  useEditor.getState().toggleHidden("inner");
  state = useEditor.getState();
  assert.equal(hitTestShape(state.doc, state.doc.nodes[compoundId], { x: 55, y: 50 }, 0), true);
  useEditor.getState().toggleHidden("inner");
  state = useEditor.getState();

  useEditor.getState().copySelected();
  useEditor.getState().paste();
  let cloned = useEditor.getState().doc.nodes[useEditor.getState().selection[0]];
  assert.equal(cloned.type, "compoundPath");
  assert.ok(cloned.childIds.every((id) => !["outer", "inner"].includes(id)));
  assert.ok(cloned.childIds.every((id) => parentIdOf(useEditor.getState().doc, id) === cloned.id));
  useEditor.getState().undo();
  useEditor.getState().setSelection([compoundId]);

  useEditor.getState().duplicateSelected();
  cloned = useEditor.getState().doc.nodes[useEditor.getState().selection[0]];
  assert.equal(cloned.type, "compoundPath");
  assert.ok(cloned.childIds.every((id) => !["outer", "inner"].includes(id)));
  useEditor.getState().undo();
  useEditor.getState().setSelection([compoundId]);
  state = useEditor.getState();
  compound = state.doc.nodes[compoundId];
  const drawCalls = [];
  const mockContext = {
    save() {}, restore() {}, transform() {}, beginPath() {}, closePath() {},
    rect() {}, lineTo() {}, bezierCurveTo() {}, fill() {}, stroke() {},
    moveTo(x, y) { drawCalls.push(["moveTo", x, y]); },
    ellipse() { drawCalls.push(["ellipse"]); },
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1,
    lineJoin: "round", lineCap: "round", globalCompositeOperation: "source-over",
  };
  paintShape(mockContext, compound, {}, state.doc);
  const ellipseCall = drawCalls.findIndex(([name]) => name === "ellipse");
  assert.ok(ellipseCall > 0);
  assert.equal(drawCalls[ellipseCall - 1][0], "moveTo");
  const svg = exportSvg(state.doc, 0);
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, / C /); // retained ellipse is exported as cubic geometry

  const loaded = parseDocument(serializeDocument(state.doc));
  assert.equal(loaded.nodes[compoundId].type, "compoundPath");
  assert.equal(loaded.nodes[loaded.nodes[compoundId].childIds[1]].type, "ellipse");
  const malformedCompound = JSON.parse(serializeDocument(state.doc));
  malformedCompound.document.nodes.outer.type = "path";
  malformedCompound.document.nodes.outer.fillRule = "nonzero";
  malformedCompound.document.nodes.outer.subpaths = [{
    anchors: [
      { p: { x: 0, y: 0 }, hIn: null, hOut: null },
      { p: { x: 10, y: 10 }, hIn: null, hOut: null },
    ],
    closed: false,
  }];
  assert.throws(
    () => parseDocument(JSON.stringify(malformedCompound)),
    /invalid child/
  );

  useEditor.getState().setSelection([compoundId]);

  useEditor.getState().updateSelectedStyle({
    fill: { type: "solid", color: "#abcdef", alpha: 1 },
    transform: [1, 0, 0, 1, 10, 5],
  });
  const childEffects = [{ id: "fx_child", type: "blur", radius: 2 }];
  const compoundEffects = [{ id: "fx_compound", type: "blur", radius: 9 }];
  useEditor.getState().setNodeEffects("inner", childEffects);
  useEditor.getState().setNodeEffects(compoundId, compoundEffects);
  useToasts.setState({ toasts: [] });
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
  assert.deepEqual(released.map((shape) => shape.id), ["outer", "inner"]);
  assert.deepEqual(released[0].effects, outerEffects);
  assert.deepEqual(released[1].effects, childEffects);
  assert.ok(useToasts.getState().toasts.some(
    (toast) => toast.kind === "info" && /effects were removed/.test(toast.message)
  ));

  useEditor.getState().undo();
  compound = useEditor.getState().doc.nodes[compoundId];
  assert.equal(compound.type, "compoundPath");
  assert.deepEqual(compound.fill, { type: "solid", color: "#abcdef", alpha: 1 });
  assert.deepEqual(compound.effects, compoundEffects);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.rootIds.length, 2);

  const openDoc = createEmptyDocument();
  openDoc.nodes.a = { ...doc.nodes.outer, id: "a" };
  openDoc.nodes.b = {
    id: "b", type: "path", ...SHAPE_BASE, fillRule: "nonzero", ...NODE_BASE, name: "open",
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
