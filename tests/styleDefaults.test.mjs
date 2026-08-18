import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let createEmptyDocument;
let getCommand;
let useEditor;

const solid = (hex) => ({ type: "solid", color: hex });

const rect = (id, patch = {}) => ({
  id,
  name: id,
  type: "rect",
  ...NODE_BASE,
  ...SHAPE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  cornerRadius: 0,
  ...patch,
});

const path = (id, patch = {}) => ({
  id,
  name: id,
  type: "path",
  ...NODE_BASE,
  ...SHAPE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  fillRule: "nonzero",
  subpaths: [
    {
      closed: false,
      anchors: [
        { p: { x: 0, y: 0 }, hIn: null, hOut: null },
        { p: { x: 10, y: 0 }, hIn: null, hOut: null },
      ],
    },
  ],
  ...patch,
});

const image = (id) => ({
  id,
  name: id,
  type: "image",
  ...NODE_BASE,
  ...SHAPE_BASE,
  transform: [1, 0, 0, 1, 0, 0],
  assetId: "asset-1",
  lockAspect: false,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
});

function load(nodes, rootIds) {
  const empty = createEmptyDocument();
  useEditor.getState().loadDocument({
    ...empty,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootIds,
  });
}

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ getCommand } = await server.ssrLoadModule("/src/commands/registry.ts"));
});

after(async () => server.close());

test("the defaults take the first selected shape's paint", () => {
  load(
    [
      rect("a", {
        fill: solid("#112233"),
        stroke: solid("#445566"),
        strokeWidth: 7,
        strokeDash: [4, 2],
        strokeDashOffset: 1,
        strokeCap: "butt",
        strokeJoin: "miter",
        strokeAlignment: "inside",
      }),
      rect("b", { fill: solid("#ffffff") }),
    ],
    ["a", "b"]
  );
  useEditor.getState().setSelection(["a", "b"]);

  useEditor.getState().setStyleFromSelection();

  const style = useEditor.getState().style;
  assert.deepEqual(style.fill, solid("#112233"));
  assert.deepEqual(style.stroke, solid("#445566"));
  assert.equal(style.strokeWidth, 7);
  assert.deepEqual(style.strokeDash, [4, 2]);
  assert.equal(style.strokeDashOffset, 1);
  assert.equal(style.strokeCap, "butt");
  assert.equal(style.strokeJoin, "miter");
  assert.equal(style.strokeAlignment, "inside");
});

test("markers come from a markable source and survive one that is not", () => {
  const marker = { shape: "arrow", scale: 2, filled: true, flip: false };
  load([path("p", { markerEnd: marker })], ["p"]);
  useEditor.getState().setSelection(["p"]);
  useEditor.getState().setStyleFromSelection();

  assert.deepEqual(useEditor.getState().style.markerEnd, marker);
  assert.equal(useEditor.getState().style.markerStart, null);
  // A copy, so editing the defaults never reaches back into the document.
  assert.notEqual(useEditor.getState().style.markerEnd, marker);

  // A rect says nothing about markers, so the ones already set stay.
  load([rect("r")], ["r"]);
  useEditor.getState().setSelection(["r"]);
  useEditor.getState().setStyleFromSelection();
  assert.deepEqual(useEditor.getState().style.markerEnd, marker);
});

test("the command needs a paintable shape first in the selection", () => {
  const command = getCommand("style.defaultsFromSelection");
  assert.ok(command);

  load([rect("a"), image("i")], ["a", "i"]);
  useEditor.getState().setSelection([]);
  assert.equal(command.enabled(useEditor.getState()), false);

  useEditor.getState().setSelection(["i"]);
  assert.equal(command.enabled(useEditor.getState()), false);

  useEditor.getState().setSelection(["a"]);
  assert.equal(command.enabled(useEditor.getState()), true);
});
