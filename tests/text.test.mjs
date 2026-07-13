import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let layoutText;
let createEmptyDocument;
let serializeDocument;
let parseDocument;
let hitTestShape;
let exportSvg;
let paintShape;
let commands;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ layoutText } = await server.ssrLoadModule("/src/canvas/textLayout.ts"));
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ serializeDocument, parseDocument } = await server.ssrLoadModule("/src/io/serialize.ts"));
  ({ hitTestShape } = await server.ssrLoadModule("/src/model/hitTest.ts"));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
  ({ paintShape } = await server.ssrLoadModule("/src/canvas/render.ts"));
  ({ COMMANDS: commands } = await server.ssrLoadModule("/src/commands/registry.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
});

after(async () => server.close());

const measure = (value) => Array.from(value).length * 10;
const layoutShape = (patch = {}) => ({
  text: "",
  textMode: "point",
  width: 0,
  fontSize: 20,
  lineHeight: 1.2,
  align: "left",
  ...patch,
});

const textShape = (patch = {}) => ({
  id: "text1",
  name: "Text",
  type: "text",
  text: "Hello",
  textMode: "point",
  x: 10,
  y: 20,
  width: 50,
  height: 28.8,
  fontFamily: "System Sans",
  fontSize: 24,
  fontWeight: 400,
  italic: false,
  lineHeight: 1.2,
  align: "left",
  fill: { type: "solid", color: "#123456", alpha: 1 },
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
  transform: [1, 0, 0, 1, 0, 0],
  transformOrigin: null,
  ...patch,
});

test("point text preserves newlines, blank lines, alignment, and an empty caret box", () => {
  const point = layoutText(
    layoutShape({ text: "abcd\nx\n", align: "right" }),
    measure
  );
  assert.equal(point.width, 40);
  assert.equal(point.height, 72);
  assert.deepEqual(point.lines.map((line) => line.text), ["abcd", "x", ""]);
  assert.deepEqual(point.lines.map((line) => line.x), [0, 30, 40]);

  const empty = layoutText(layoutShape(), measure);
  assert.equal(empty.width, 10);
  assert.equal(empty.height, 24);
  assert.equal(empty.lines.length, 1);
});

test("area text greedily wraps words, CJK, and overlong Latin tokens", () => {
  const words = layoutText(
    layoutShape({ textMode: "area", text: "one two", width: 50 }),
    measure
  );
  assert.deepEqual(words.lines.map((line) => line.text), ["one", "two"]);

  const cjk = layoutText(
    layoutShape({ textMode: "area", text: "日本語文字列", width: 30 }),
    measure
  );
  assert.deepEqual(cjk.lines.map((line) => line.text), ["日本語", "文字列"]);

  const long = layoutText(
    layoutShape({ textMode: "area", text: "abcdef", width: 30, align: "center" }),
    measure
  );
  assert.deepEqual(long.lines.map((line) => line.text), ["abc", "def"]);
  assert.deepEqual(long.lines.map((line) => line.x), [0, 0]);
});

test("v15 text documents round-trip and malformed typography is rejected", () => {
  const doc = createEmptyDocument();
  doc.nodes.text1 = textShape();
  doc.rootIds = ["text1"];
  const json = serializeDocument(doc);
  assert.equal(JSON.parse(json).version, 15);
  assert.deepEqual(parseDocument(json).nodes.text1, doc.nodes.text1);

  const v13 = JSON.parse(json);
  v13.version = 13;
  delete v13.document.nodes.text1;
  v13.document.rootIds = [];
  assert.deepEqual(parseDocument(JSON.stringify(v13)).rootIds, []);

  const malformed = JSON.parse(json);
  malformed.document.nodes.text1.fontWeight = 450;
  assert.throws(() => parseDocument(JSON.stringify(malformed)), /malformed/);
});

test("text uses its stored bounds for transformed hit testing", () => {
  const doc = createEmptyDocument();
  const shape = textShape({ x: 0, y: 0, width: 40, height: 20, transform: [0, 1, -1, 0, 100, 0] });
  doc.nodes.text1 = shape;
  doc.rootIds = ["text1"];
  assert.equal(hitTestShape(doc, shape, { x: 90, y: 10 }, 0), true);
  assert.equal(hitTestShape(doc, shape, { x: 70, y: 10 }, 0), false);
});

test("Canvas and SVG render laid-out text with font styling and escaping", () => {
  const shape = textShape({ text: "A<&\nB", fontWeight: 700, italic: true, stroke: { type: "solid", color: "#000000", alpha: 1 }, strokeWidth: 1 });
  const doc = createEmptyDocument();
  doc.nodes.text1 = shape;
  doc.rootIds = ["text1"];

  const calls = [];
  const ctx = {
    save() {}, restore() {}, transform() {},
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "round",
    measureText: (text) => ({ width: measure(text) }),
    fillText: (text, x, y) => calls.push(["fill", text, x, y]),
    strokeText: (text, x, y) => calls.push(["stroke", text, x, y]),
  };
  paintShape(ctx, shape);
  assert.match(ctx.font, /italic 700 24px/);
  assert.deepEqual(calls.map((call) => call.slice(0, 2)), [
    ["fill", "A<&"], ["fill", "B"], ["stroke", "A<&"], ["stroke", "B"],
  ]);

  const svg = exportSvg(doc, { margin: 0 });
  assert.match(svg, /<text /);
  assert.match(svg, /font-weight="700"/);
  assert.match(svg, /font-style="italic"/);
  assert.match(svg, /<tspan[^>]*>A&lt;&amp;<\/tspan>/);
  assert.equal((svg.match(/<tspan/g) ?? []).length, 2);
});

test("the Text tool is exposed through the T command", () => {
  const command = commands.find((entry) => entry.id === "tool.text");
  assert.ok(command);
  assert.deepEqual(command.keys, [{ key: "t" }]);
});

test("a committed text edit is one undo step and empty text remains a node", () => {
  useEditor.getState().newDocument();
  useEditor.getState().addShape(textShape());
  const beforeEdit = useEditor.getState().history.past.length;
  useEditor.getState().updateShape(textShape({ text: "", width: 12 }));
  assert.equal(useEditor.getState().history.past.length, beforeEdit + 1);
  assert.equal(useEditor.getState().doc.nodes.text1.text, "");

  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes.text1.text, "Hello");
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes.text1.text, "");
});
