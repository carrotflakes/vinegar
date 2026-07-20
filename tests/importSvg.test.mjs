import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import * as paperNs from "paper";
import { createServer } from "vite";

const paper = paperNs.default ?? paperNs;

let server;
let clippingMask;
let convertSvgItem;
let nodeWorldBounds;
let useEditor;
let isAreal;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ clippingMask } =
    await server.ssrLoadModule("/src/model/clippingMask.ts"));
  ({ convertSvgItem } =
    await server.ssrLoadModule("/src/io/importSvg.ts"));
  ({ nodeWorldBounds } =
    await server.ssrLoadModule("/src/model/bounds.ts"));
  ({ useEditor } =
    await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ isAreal } = await server.ssrLoadModule("/src/model/boolean.ts"));
});

beforeEach(() => {
  useEditor.getState().newDocument();
});

after(async () => server.close());

function makeScope() {
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1, 1));
  return scope;
}

function importedContent(imported) {
  const root = imported.nodes[imported.rootId];
  assert.equal(root.type, "group");
  assert.equal(root.childIds.length, 1);
  return imported.nodes[root.childIds[0]];
}

test("Paper paths retain curves, transforms, and solid stroke styling", () => {
  const scope = makeScope();
  const path = new scope.Path({
    segments: [
      new scope.Segment([0, 0], null, [10, 0]),
      new scope.Segment([20, 20], [-10, 0], null),
      new scope.Segment([0, 20]),
    ],
    closed: true,
    insert: false,
  });
  path.name = "Curve";
  path.applyMatrix = false;
  path.matrix = new scope.Matrix(2, 0, 0, 2, 10, 15);
  path.fillColor = new scope.Color(0.2, 0.4, 0.6, 0.5);
  path.fillRule = "evenodd";
  path.strokeColor = new scope.Color("#112233");
  path.strokeWidth = 3;
  path.strokeCap = "butt";
  path.strokeJoin = "bevel";
  path.dashArray = [4, 2];
  path.dashOffset = 1;

  const imported = convertSvgItem(path, "curve.svg");
  const node = importedContent(imported);
  assert.equal(node.type, "path");
  assert.equal(node.fillRule, "evenodd");
  assert.equal(node.name, "Curve");
  assert.deepEqual(node.transform, [2, 0, 0, 2, 10, 15]);
  assert.deepEqual(node.fill, {
    type: "solid",
    color: "#336699",
    alpha: 0.5,
  });
  assert.deepEqual(node.stroke, {
    type: "solid",
    color: "#112233",
    alpha: 1,
  });
  assert.equal(node.strokeWidth, 3);
  assert.equal(node.strokeCap, "butt");
  assert.equal(node.strokeJoin, "bevel");
  assert.deepEqual(node.strokeDash, [4, 2]);
  assert.equal(node.strokeDashOffset, 1);
  assert.equal(node.subpaths[0].closed, true);
  assert.deepEqual(node.subpaths[0].anchors[0], {
    p: { x: 0, y: 0 },
    hIn: null,
    hOut: { x: 10, y: 0 },
  });
  assert.deepEqual(node.subpaths[0].anchors[1].hIn, { x: 10, y: 20 });
});

test("Paper gradients retain stops, alpha, angle, and radial type", () => {
  const scope = makeScope();
  const path = new scope.Path.Rectangle({
    point: [0, 0],
    size: [100, 100],
    insert: false,
  });
  const linear = new scope.Gradient([
    new scope.GradientStop(new scope.Color(1, 0, 0, 0.5), 0),
    new scope.GradientStop(new scope.Color("#0000ff"), 1),
  ], false);
  path.fillColor = new scope.Color(linear, [10, 20], [30, 40]);
  path.fillColor.alpha = 0.8;
  const radial = new scope.Gradient([
    new scope.GradientStop(new scope.Color("#ffffff"), 0),
    new scope.GradientStop(new scope.Color("#000000"), 1),
  ], true);
  path.strokeColor = new scope.Color(radial, [50, 50], [100, 50]);
  path.strokeWidth = 4;

  const imported = convertSvgItem(path);
  const node = importedContent(imported);
  assert.equal(node.type, "path");
  assert.deepEqual(node.fill, {
    type: "linear",
    angle: Math.PI / 4,
    stops: [
      { offset: 0, color: "#ff0000", alpha: 0.4 },
      { offset: 1, color: "#0000ff", alpha: 0.8 },
    ],
  });
  assert.deepEqual(node.stroke, {
    type: "radial",
    stops: [
      { offset: 0, color: "#ffffff", alpha: 1 },
      { offset: 1, color: "#000000", alpha: 1 },
    ],
  });
});

test("open fill paths (no Z) keep their fill and enclose an implicit area", () => {
  // SVG fills paths without a closing Z by implicitly closing them, so import
  // must not drop the fill or force the path closed on the round trip.
  const scope = makeScope();
  const path = new scope.Path({
    segments: [[0, 0], [20, 0], [10, 20]],
    closed: false,
    insert: false,
  });
  path.fillColor = new scope.Color("#00ff00");

  const imported = convertSvgItem(path);
  const node = importedContent(imported);
  assert.equal(node.type, "path");
  assert.equal(node.subpaths[0].closed, false);
  assert.deepEqual(node.fill, {
    type: "solid",
    color: "#00ff00",
    alpha: 1,
  });
  // The implicit close gives the open path a fillable area for boolean ops.
  assert.equal(isAreal(node), true);
});

test("groups keep paint order and convert Paper clipping masks", () => {
  const scope = makeScope();
  const mask = new scope.Path.Rectangle({
    point: [0, 0],
    size: [50, 50],
    insert: false,
  });
  mask.name = "Mask";
  const content = new scope.Path.Rectangle({
    point: [-10, -10],
    size: [80, 80],
    insert: false,
  });
  content.name = "Content";
  const group = new scope.Group({ children: [mask, content], insert: false });
  group.name = "Clipped";
  group.clipped = true;

  const imported = convertSvgItem(group);
  const converted = importedContent(imported);
  assert.equal(converted.type, "group");
  assert.equal(converted.name, "Clipped");
  assert.equal(converted.clip, true);
  assert.equal(converted.childIds.length, 2);
  assert.equal(imported.nodes[converted.childIds[0]].name, "Content");
  assert.equal(imported.nodes[converted.childIds[1]].name, "Mask");

  const doc = {
    nodes: imported.nodes,
    rootIds: [imported.rootId],
    symbols: {},
    artboards: [],
    settings: { unit: "px", dpi: 96, gridSize: 50 },
    metadata: { createdAt: "", modifiedAt: "" },
    assets: {},
    extensions: {},
  };
  assert.equal(clippingMask(doc, converted)?.name, "Mask");
});

test("even-odd Paper compound paths become containers with real path children", () => {
  const scope = makeScope();
  const outer = new scope.Path.Rectangle({
    point: [0, 0],
    size: [100, 100],
    insert: false,
  });
  const inner = new scope.Path.Rectangle({
    point: [25, 25],
    size: [50, 50],
    insert: false,
  });
  const compound = new scope.CompoundPath({
    children: [outer, inner],
    insert: false,
  });
  compound.fillRule = "evenodd";
  compound.fillColor = new scope.Color("#ff0000");

  const imported = convertSvgItem(compound);
  const node = importedContent(imported);
  assert.equal(node.type, "compoundPath");
  assert.equal("fillRule" in node, false);
  assert.equal(node.childIds.length, 2);
  assert.ok(node.childIds.every((id) => imported.nodes[id].type === "path"));
  assert.deepEqual(node.fill, {
    type: "solid",
    color: "#ff0000",
    alpha: 1,
  });
});

test("unsupported-only Paper items report that nothing can be imported", () => {
  const scope = makeScope();
  const text = new scope.PointText({
    point: [0, 0],
    content: "Unsupported text",
    insert: false,
  });
  assert.throws(
    () => convertSvgItem(text),
    /no supported vector content/
  );
});

test("placed SVG content is fitted, selected, and undoable as one group", () => {
  const scope = makeScope();
  const rect = new scope.Path.Rectangle({
    point: [0, 0],
    size: [200, 100],
    insert: false,
  });
  const imported = convertSvgItem(rect, "Large icon");

  useEditor.getState().placeImportedSvg(
    imported,
    { x: 300, y: 200 },
    { width: 100, height: 100 }
  );

  let state = useEditor.getState();
  const rootId = imported.rootId;
  const bounds = nodeWorldBounds(state.doc, rootId);
  assert.ok(bounds);
  assert.ok(Math.abs(bounds.x + bounds.width / 2 - 300) < 1e-9);
  assert.ok(Math.abs(bounds.y + bounds.height / 2 - 200) < 1e-9);
  assert.ok(Math.abs(bounds.width - 100) < 1e-9);
  assert.ok(Math.abs(bounds.height - 50) < 1e-9);
  assert.deepEqual(state.selection, [rootId]);
  assert.equal(state.history.past.length, 1);

  state.undo();
  state = useEditor.getState();
  assert.equal(state.doc.nodes[rootId], undefined);
  assert.equal(state.history.future.length, 1);

  state.redo();
  state = useEditor.getState();
  assert.equal(state.doc.nodes[rootId]?.type, "group");
  assert.deepEqual(state.selection, []);
});
