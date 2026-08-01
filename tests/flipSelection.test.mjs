import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let createEmptyDocument;
let getCommand;
let matchKeydown;
let matrixRotationAngle;
let nodeWorldBounds;
let useEditor;

const rect = (id, x, y, width, height, transform = [1, 0, 0, 1, 0, 0]) => ({
  id,
  name: id,
  type: "rect",
  ...NODE_BASE,
  ...SHAPE_BASE,
  transform,
  x,
  y,
  width,
  height,
  cornerRadius: 0,
});

const group = (id, childIds, transform = [1, 0, 0, 1, 0, 0]) => ({
  id,
  name: id,
  type: "group",
  ...NODE_BASE,
  transform,
  childIds,
  clipsToMask: false,
});

const frame = (id) => ({
  id,
  name: id,
  type: "frame",
  ...NODE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  clipsContent: true,
  width: 100,
  height: 100,
  background: null,
  childIds: [],
});

function load(nodes, rootIds) {
  const empty = createEmptyDocument();
  useEditor.getState().loadDocument({
    ...empty,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootIds,
  });
}

function bounds(id) {
  return nodeWorldBounds(useEditor.getState().doc, id);
}

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ nodeWorldBounds } = await server.ssrLoadModule(
    "/src/model/geometry/bounds.ts"
  ));
  ({ matrixRotationAngle } = await server.ssrLoadModule(
    "/src/model/geometry/matrix.ts"
  ));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ getCommand, matchKeydown } = await server.ssrLoadModule(
    "/src/commands/registry.ts"
  ));
});

after(async () => server.close());

test("flips one rotated shape in its selection-frame horizontal axis", () => {
  const original = [0, 1, -1, 0, 100, 20];
  load([rect("a", 0, 0, 10, 20, original)], ["a"]);
  useEditor.getState().setSelection(["a"]);

  useEditor.getState().flipSelectedHorizontally();

  assert.deepEqual(
    useEditor.getState().doc.nodes.a.transform,
    [0, -1, -1, 0, 100, 30]
  );
  assert.equal(
    matrixRotationAngle(useEditor.getState().doc.nodes.a.transform),
    Math.PI / 2
  );
  assert.deepEqual(bounds("a"), { x: 80, y: 20, width: 20, height: 10 });
  assert.equal(
    useEditor.getState().history.past.at(-1)?.label,
    "Flip horizontally"
  );

  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.nodes.a.transform, original);
  useEditor.getState().redo();
  assert.deepEqual(
    useEditor.getState().doc.nodes.a.transform,
    [0, -1, -1, 0, 100, 30]
  );
});

test("flips multiple selected roots as one unit and preserves transient state", () => {
  load(
    [rect("left", 0, 0, 10, 10), rect("right", 30, 0, 10, 10)],
    ["left", "right"]
  );
  const editor = useEditor.getState();
  editor.setSelection(["left", "right"]);
  useEditor.getState().setSelectionPivot({ x: 5, y: 7 });
  useEditor.getState().setSelectionTransform([1, 0, 0, 1, 0, 0]);

  useEditor.getState().flipSelectedHorizontally();

  assert.deepEqual(bounds("left"), { x: 30, y: 0, width: 10, height: 10 });
  assert.deepEqual(bounds("right"), { x: 0, y: 0, width: 10, height: 10 });
  assert.deepEqual(useEditor.getState().selectionPivot, { x: 35, y: 7 });
  assert.deepEqual(
    useEditor.getState().selectionTransform,
    [-1, 0, 0, 1, 40, 0]
  );

  useEditor.getState().flipSelectedHorizontally();
  assert.deepEqual(
    useEditor.getState().doc.nodes.left.transform,
    [1, 0, 0, 1, 0, 0]
  );
  assert.deepEqual(
    useEditor.getState().doc.nodes.right.transform,
    [1, 0, 0, 1, 0, 0]
  );
  assert.deepEqual(useEditor.getState().selectionPivot, { x: 5, y: 7 });
  assert.deepEqual(
    useEditor.getState().selectionTransform,
    [1, 0, 0, 1, 0, 0]
  );
});

test("flips vertically and restores the original transform on a second flip", () => {
  load(
    [rect("top", 0, 0, 10, 10), rect("bottom", 0, 30, 10, 10)],
    ["top", "bottom"]
  );
  useEditor.getState().setSelection(["top", "bottom"]);
  useEditor.getState().setSelectionPivot({ x: 3, y: 5 });
  useEditor.getState().setSelectionTransform([1, 0, 0, 1, 0, 0]);

  useEditor.getState().flipSelectedVertically();

  assert.deepEqual(bounds("top"), { x: 0, y: 30, width: 10, height: 10 });
  assert.deepEqual(bounds("bottom"), { x: 0, y: 0, width: 10, height: 10 });
  assert.deepEqual(useEditor.getState().selectionPivot, { x: 3, y: 35 });
  assert.deepEqual(
    useEditor.getState().selectionTransform,
    [1, 0, 0, -1, 0, 40]
  );
  assert.equal(
    useEditor.getState().history.past.at(-1)?.label,
    "Flip vertically"
  );

  useEditor.getState().flipSelectedVertically();
  assert.deepEqual(
    useEditor.getState().doc.nodes.top.transform,
    [1, 0, 0, 1, 0, 0]
  );
  assert.deepEqual(
    useEditor.getState().doc.nodes.bottom.transform,
    [1, 0, 0, 1, 0, 0]
  );
  assert.deepEqual(useEditor.getState().selectionPivot, { x: 3, y: 5 });
  assert.deepEqual(
    useEditor.getState().selectionTransform,
    [1, 0, 0, 1, 0, 0]
  );
});

test("flips only selection roots across nested parent spaces", () => {
  load(
    [
      group("g", ["inside"], [1, 0, 0, 1, 100, 0]),
      rect("inside", 0, 0, 10, 10),
      rect("outside", 200, 0, 10, 10),
    ],
    ["g", "outside"]
  );
  useEditor.getState().setSelection(["inside", "outside"]);

  useEditor.getState().flipSelectedHorizontally();

  assert.deepEqual(bounds("inside"), { x: 200, y: 0, width: 10, height: 10 });
  assert.deepEqual(bounds("outside"), { x: 100, y: 0, width: 10, height: 10 });
  assert.deepEqual(
    useEditor.getState().doc.nodes.g.transform,
    [1, 0, 0, 1, 100, 0]
  );
});

test("exposes flip shortcuts for artwork but leaves frames unchanged", () => {
  load([rect("a", 0, 0, 10, 10)], ["a"]);
  useEditor.getState().setSelection(["a"]);
  const horizontal = getCommand("structure.flipHorizontal");
  const vertical = getCommand("structure.flipVertical");
  assert.ok(horizontal);
  assert.ok(vertical);
  assert.equal(horizontal.enabled(useEditor.getState()), true);
  assert.equal(vertical.enabled(useEditor.getState()), true);
  assert.equal(
    matchKeydown(
      {
        key: "H",
        code: "KeyH",
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      },
      useEditor.getState()
    )?.cmd.id,
    "structure.flipHorizontal"
  );
  assert.equal(
    matchKeydown(
      {
        key: "V",
        code: "KeyV",
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      },
      useEditor.getState()
    )?.cmd.id,
    "structure.flipVertical"
  );

  load([frame("f")], ["f"]);
  useEditor.getState().setSelection(["f"]);
  assert.equal(horizontal.enabled(useEditor.getState()), false);
  assert.equal(vertical.enabled(useEditor.getState()), false);
  useEditor.getState().flipSelectedHorizontally();
  useEditor.getState().flipSelectedVertically();
  assert.deepEqual(
    useEditor.getState().doc.nodes.f.transform,
    [1, 0, 0, 1, 0, 0]
  );
  assert.equal(useEditor.getState().history.past.length, 0);
});

test("reports axis mirrors without adding a half-turn", () => {
  assert.equal(matrixRotationAngle([-1, 0, 0, 1, 40, 0]), 0);
  assert.equal(matrixRotationAngle([1, 0, 0, -1, 0, 40]), 0);
  assert.equal(matrixRotationAngle([0, -1, -1, 0, 100, 30]), Math.PI / 2);
  assert.equal(matrixRotationAngle([0, 1, -1, 0, 100, 20]), Math.PI / 2);
});
