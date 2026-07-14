import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let useEditor;
let paintNode;
let pickShape;
let selectedShapes;
let exportSvg;
let contentBounds;
let serializeDocument;
let parseDocument;
let commands;
let matchKeydown;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ paintNode } = await server.ssrLoadModule("/src/canvas/render.ts"));
  ({ pickShape, selectedShapes } = await server.ssrLoadModule("/src/canvas/picking.ts"));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
  ({ contentBounds } = await server.ssrLoadModule("/src/io/exportBounds.ts"));
  ({ serializeDocument, parseDocument } = await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ COMMANDS: commands, matchKeydown } =
    await server.ssrLoadModule("/src/commands/registry.ts"));
});

after(async () => server.close());

const IDENTITY = [1, 0, 0, 1, 0, 0];
const paint = (color) => ({ type: "solid", color, alpha: 1 });

const rect = (id, x, y, width, height, extra = {}) => ({
  id,
  name: id,
  type: "rect",
  x,
  y,
  width,
  height,
  fill: paint("#e11d48"),
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
  transform: [...IDENTITY],
  transformOrigin: null,
  ...extra,
});

const group = (id, childIds, extra = {}) => ({
  id,
  name: id,
  type: "group",
  childIds,
  opacity: 1,
  transform: [...IDENTITY],
  transformOrigin: null,
  ...extra,
});

function mockContext() {
  const calls = [];
  const ctx = {
    canvas: { width: 300, height: 200 },
    calls,
    save() { calls.push(["save"]); },
    restore() { calls.push(["restore"]); },
    transform(...matrix) { calls.push(["transform", ...matrix]); },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    setTransform(...matrix) { calls.push(["setTransform", ...matrix]); },
    drawImage(...args) { calls.push(["drawImage", ...args]); },
    beginPath() { calls.push(["beginPath"]); },
    rect(x, y, width, height) { calls.push(["rect", x, y, width, height]); },
    moveTo(x, y) { calls.push(["moveTo", x, y]); },
    lineTo(x, y) { calls.push(["lineTo", x, y]); },
    closePath() { calls.push(["closePath"]); },
    bezierCurveTo(...args) { calls.push(["bezierCurveTo", ...args]); },
    ellipse(...args) { calls.push(["ellipse", ...args]); },
    clip(rule) { calls.push(["clip", rule]); },
    fill(rule) { calls.push(["fill", rule]); },
    stroke() { calls.push(["stroke"]); },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "round",
    lineCap: "round",
  };
  return ctx;
}

function editableDocument() {
  const doc = createEmptyDocument();
  doc.nodes.content = rect("content", 0, 0, 180, 120);
  doc.nodes.mask = {
    id: "mask",
    name: "mask",
    type: "polygon",
    polys: [[[
      { x: 20, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 90 },
      { x: 20, y: 90 },
    ]]],
    fill: paint("#22c55e"),
    stroke: paint("#0f172a"),
    strokeWidth: 9,
    opacity: 0.25,
    blendMode: "screen",
    hidden: true,
    transform: [...IDENTITY],
    transformOrigin: null,
  };
  doc.rootIds = ["content", "mask"];
  return doc;
}

test("make/release actions preserve order and appearance and are undoable", () => {
  const editor = useEditor.getState();
  editor.loadDocument(editableDocument());
  useEditor.getState().setSelection(["content", "mask"]);

  const make = commands.find((command) => command.id === "structure.makeClippingMask");
  const release = commands.find((command) => command.id === "structure.releaseClippingMask");
  assert.ok(make && release);
  assert.equal(make.enabled(useEditor.getState()), true);
  make.run(useEditor.getState());

  let state = useEditor.getState();
  const clipId = state.doc.rootIds[0];
  assert.equal(state.doc.nodes[clipId].clip, true);
  assert.equal(state.doc.nodes[clipId].name, "Clip Group");
  assert.deepEqual(state.doc.nodes[clipId].childIds, ["content", "mask"]);
  assert.deepEqual(state.selection, [clipId]);
  assert.equal(release.enabled(state), true);

  state.updateGroupStyle(clipId, {
    transform: [1, 0, 0, 1, 12, 8],
    opacity: 0.5,
    blendMode: "multiply",
  });
  useEditor.getState().setActiveGroup(clipId);
  useEditor.getState().releaseClippingMaskSelected();
  state = useEditor.getState();
  assert.deepEqual(state.doc.rootIds, ["content", "mask"]);
  assert.deepEqual(state.selection, ["content", "mask"]);
  assert.deepEqual(state.doc.nodes.content.transform, [1, 0, 0, 1, 12, 8]);
  assert.equal(state.doc.nodes.content.opacity, 0.5);
  assert.equal(state.doc.nodes.content.blendMode, "multiply");
  assert.equal(state.doc.nodes.mask.opacity, 0.125);
  assert.equal(state.doc.nodes.mask.blendMode, "screen");
  assert.equal(state.doc.nodes.mask.hidden, true);
  assert.equal(state.activeGroupId, null);

  state.undo();
  assert.equal(useEditor.getState().doc.nodes[clipId].clip, true);
  state.redo();
  assert.deepEqual(useEditor.getState().doc.rootIds, ["content", "mask"]);
});

test("Canvas, SVG, bounds, and v15 serialization share the clipping model", () => {
  const doc = editableDocument();
  doc.nodes.clip = group("clip", ["content", "mask"], { clip: true });
  doc.rootIds = ["clip"];

  const ctx = mockContext();
  paintNode(ctx, doc, "clip");
  assert.deepEqual(
    ctx.calls.filter(([name]) => name === "clip"),
    [["clip", "evenodd"]]
  );
  assert.equal(ctx.calls.filter(([name]) => name === "fill").length, 1);
  assert.deepEqual(contentBounds(doc, 0), { x: 20, y: 10, width: 80, height: 80 });

  const previousDocument = globalThis.document;
  const composited = structuredClone(doc);
  composited.nodes.clip.opacity = 0.5;
  composited.nodes.clip.blendMode = "multiply";
  const outerContext = mockContext();
  const layerContext = mockContext();
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => layerContext,
    }),
  };
  try {
    paintNode(outerContext, composited, "clip");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  assert.deepEqual(
    layerContext.calls.filter(([name]) => name === "clip"),
    [["clip", "evenodd"]]
  );
  assert.equal(outerContext.calls.some(([name]) => name === "drawImage"), true);

  const svg = exportSvg(doc, { margin: 0 });
  assert.equal((svg.match(/<clipPath /g) ?? []).length, 1);
  assert.match(svg, /clip-rule="evenodd"/);
  assert.match(svg, /clip-path="url\(#clip\d+\)"/);
  assert.match(svg, /#e11d48/);
  assert.doesNotMatch(svg, /#22c55e|#0f172a/);
  assert.doesNotMatch(svg, /isolation:isolate/);

  const json = serializeDocument(doc);
  assert.equal(JSON.parse(json).version, 18);
  const loaded = parseDocument(json);
  assert.equal(loaded.nodes.clip.clip, true);
  assert.deepEqual(loaded.nodes.clip.childIds, ["content", "mask"]);

  const old = JSON.parse(json);
  old.version = 14;
  delete old.document.nodes.clip.clip;
  assert.equal(parseDocument(JSON.stringify(old)).nodes.clip.clip, undefined);

  const falseClip = JSON.parse(json);
  falseClip.document.nodes.clip.clip = false;
  assert.throws(() => parseDocument(JSON.stringify(falseClip)), /malformed/i);
});

test("drilling into a clip group makes content pickable ahead of its mask", () => {
  const doc = editableDocument();
  doc.nodes.clip = group("clip", ["content", "mask"], { clip: true });
  doc.rootIds = ["clip"];
  const editor = useEditor.getState();
  editor.loadDocument(doc);
  const toolContext = { hitScale: () => 1 };

  assert.deepEqual(selectedShapes(doc, ["clip"]).map((shape) => shape.id), ["mask"]);
  assert.equal(pickShape(toolContext, { x: 30, y: 30 }), "mask");
  useEditor.getState().setActiveGroup("clip");
  assert.equal(pickShape(toolContext, { x: 30, y: 30 }), "content");
});

test("copy and paste retain clipping-group structure", () => {
  const doc = editableDocument();
  doc.nodes.clip = group("clip", ["content", "mask"], { clip: true });
  doc.rootIds = ["clip"];
  const editor = useEditor.getState();
  editor.loadDocument(doc);
  useEditor.getState().setSelection(["clip"]);
  useEditor.getState().copySelected();
  useEditor.getState().paste();

  const state = useEditor.getState();
  assert.equal(state.doc.rootIds.length, 2);
  const pasted = state.doc.nodes[state.selection[0]];
  assert.equal(pasted.type, "group");
  assert.equal(pasted.clip, true);
  assert.equal(pasted.childIds.length, 2);
  assert.equal(state.doc.nodes[pasted.childIds[1]].type, "polygon");
});

test("nested masks get distinct SVG definitions and invalid tree edits are refused", () => {
  const doc = createEmptyDocument();
  doc.nodes.content = rect("content", 0, 0, 100, 100);
  doc.nodes.innerMask = rect("innerMask", 10, 10, 60, 60, {
    fill: null,
    transform: [1, 0, 0, 1, 3, 4],
  });
  doc.nodes.inner = group("inner", ["content", "innerMask"], { clip: true });
  doc.nodes.outerMask = rect("outerMask", 20, 20, 40, 40, { fill: null });
  doc.nodes.outer = group("outer", ["inner", "outerMask"], { clip: true });
  doc.rootIds = ["outer"];

  const svg = exportSvg(doc, { margin: 0 });
  const ids = [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  assert.equal((svg.match(/clip-path="url\(#/g) ?? []).length, 2);
  assert.match(svg, /<clipPath[^>]*>.*transform="matrix\(1 0 0 1 3 4\)"/s);

  const invalid = createEmptyDocument();
  invalid.nodes.line = {
    id: "line", name: "line", type: "line", x1: 0, y1: 0, x2: 50, y2: 50,
    fill: null, stroke: paint("#000000"), strokeWidth: 1, opacity: 1,
    transform: [...IDENTITY], transformOrigin: null,
  };
  invalid.nodes.mask = rect("mask", 0, 0, 50, 50);
  invalid.nodes.clip = group("clip", ["line", "mask"], { clip: true });
  invalid.rootIds = ["clip"];
  const editor = useEditor.getState();
  editor.loadDocument(invalid);
  useEditor.getState().setSelection(["mask"]);
  useEditor.getState().sendToBack();
  assert.deepEqual(useEditor.getState().doc.nodes.clip.childIds, ["line", "mask"]);
  useEditor.getState().deleteSelected();
  assert.ok(useEditor.getState().doc.nodes.mask);
  assert.deepEqual(useEditor.getState().selection, ["mask"]);

  useEditor.getState().setSelection(["line", "mask"]);
  useEditor.getState().createSymbolFromSelection();
  assert.deepEqual(useEditor.getState().doc.rootIds, ["clip"]);
  assert.equal(Object.keys(useEditor.getState().doc.symbols).length, 0);
  assert.deepEqual(useEditor.getState().selection, ["line", "mask"]);
});

test("standard clipping-mask shortcuts are registered", () => {
  const make = matchKeydown({
    key: "7", code: "Digit7", ctrlKey: true, metaKey: false,
    shiftKey: false, altKey: false,
  });
  const release = matchKeydown({
    key: "7", code: "Digit7", ctrlKey: true, metaKey: false,
    shiftKey: false, altKey: true,
  });
  assert.equal(make?.cmd.id, "structure.makeClippingMask");
  assert.equal(release?.cmd.id, "structure.releaseClippingMask");
});
