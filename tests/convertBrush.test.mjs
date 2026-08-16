import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let canConvertPathToBrush;
let convertPathToBrush;
let convertBrushToCenterlinePath;
let canConvertBrushToOutline;
let convertBrushToOutlinePath;
let createEmptyDocument;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({
    canConvertPathToBrush,
    convertPathToBrush,
    convertBrushToCenterlinePath,
    canConvertBrushToOutline,
    convertBrushToOutlinePath,
  } = await server.ssrLoadModule("/src/model/brush/convertBrush.ts"));
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
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
  effects: [{ id: "fx_blur", type: "blur", radius: 2 }],
  transform: [0, 1, -1, 0, 80, 30],
  transformOrigin: { x: 4, y: 5 },
  ...patch,
});

const openSubpath = () => ({
  closed: false,
  anchors: [
    { p: { x: 0, y: 0 }, hIn: null, hOut: { x: 15, y: -5 }, t: "smooth" },
    { p: { x: 40, y: 20 }, hIn: { x: 25, y: 25 }, hOut: null },
  ],
});

const path = (id, patch = {}) => ({
  id,
  name: id,
  type: "path",
  ...SHAPE_BASE,
  fillRule: "nonzero",
  ...NODE_BASE,
  subpaths: [openSubpath()],
  ...appearance(),
  ...patch,
});

const brush = (id, patch = {}) => ({
  id,
  name: id,
  type: "brush",
  ...SHAPE_BASE,
  ...NODE_BASE,
  anchors: [
    { p: { x: 0, y: 0 }, hIn: null, hOut: { x: 15, y: -5 }, w: 0.5 },
    { p: { x: 40, y: 20 }, hIn: { x: 25, y: 25 }, hOut: null, w: 1.5 },
  ],
  ...appearance({ stroke: solid("#8844ff"), strokeWidth: 12 }),
  ...patch,
});

test("path converts to a uniform-width brush in place", () => {
  const source = path("Stroke");
  assert.equal(canConvertPathToBrush(source), true);
  const result = convertPathToBrush(source);
  assert.equal(result.group, null);
  assert.equal(result.brushes.length, 1);

  const [b] = result.brushes;
  assert.equal(b.type, "brush");
  assert.equal(b.id, source.id);
  assert.equal(b.name, source.name);
  // Painted with the stroke paint; base width comes from strokeWidth; no fill.
  assert.deepEqual(b.stroke, source.stroke);
  assert.equal(b.strokeWidth, source.strokeWidth);
  assert.equal(b.fill, null);
  // Centerline geometry is preserved; every anchor gets full width.
  assert.deepEqual(
    b.anchors.map((a) => a.p),
    source.subpaths[0].anchors.map((a) => a.p)
  );
  assert.ok(b.anchors.every((a) => a.w === 1));
  assert.equal(b.anchors[0].t, "smooth");
  assert.deepEqual(b.transform, source.transform);
  assert.deepEqual(b.effects, source.effects);
  assert.equal(b.generator, null);
});

test("fill-only path with no stroke width falls back to fill paint and default width", () => {
  const source = path("Fill only", {
    stroke: null,
    strokeWidth: 0,
    fill: solid("#abcdef"),
  });
  const [b] = convertPathToBrush(source).brushes;
  assert.deepEqual(b.stroke, source.fill);
  assert.equal(b.strokeWidth, 8);
});

test("multi-contour path yields one brush per contour wrapped in a group", () => {
  const source = path("Two lines", {
    subpaths: [
      openSubpath(),
      {
        closed: true,
        anchors: [
          { p: { x: 0, y: 50 }, hIn: null, hOut: null },
          { p: { x: 30, y: 60 }, hIn: null, hOut: null },
          { p: { x: 30, y: 90 }, hIn: null, hOut: null },
        ],
      },
    ],
  });
  const result = convertPathToBrush(source);
  assert.ok(result.group);
  assert.equal(result.brushes.length, 2);
  assert.equal(result.group.type, "group");
  assert.deepEqual(
    result.group.childIds,
    result.brushes.map((b) => b.id)
  );
  // The group carries composite state; the pieces are neutral in source space.
  assert.deepEqual(result.group.transform, source.transform);
  assert.deepEqual(result.group.effects, source.effects);
  for (const b of result.brushes) {
    assert.deepEqual(b.transform, IDENTITY);
    assert.deepEqual(b.effects, []);
    assert.notEqual(b.id, source.id);
  }
  // A closed contour becomes an open centerline.
  assert.equal(result.brushes[1].anchors.length, 3);
});

test("single-anchor contours are skipped; a path with none does not convert", () => {
  const dot = path("Dot", {
    subpaths: [{ closed: false, anchors: [{ p: { x: 1, y: 2 }, hIn: null, hOut: null }] }],
  });
  assert.equal(canConvertPathToBrush(dot), false);
  assert.equal(convertPathToBrush(dot), null);
});

test("brush converts to an open stroked path along its centerline", () => {
  const source = brush("Pressure stroke");
  const p = convertBrushToCenterlinePath(source);

  assert.equal(p.type, "path");
  assert.equal(p.id, source.id);
  assert.equal(p.subpaths.length, 1);
  assert.equal(p.subpaths[0].closed, false);
  // Centerline geometry is preserved; width multipliers are dropped.
  assert.deepEqual(
    p.subpaths[0].anchors.map((a) => a.p),
    source.anchors.map((a) => a.p)
  );
  assert.ok(p.subpaths[0].anchors.every((a) => !("w" in a)));
  // Brush stroke paint and base width become the path stroke; no fill.
  assert.deepEqual(p.stroke, source.stroke);
  assert.equal(p.strokeWidth, source.strokeWidth);
  assert.equal(p.fill, null);
  assert.deepEqual(p.transform, source.transform);
  assert.deepEqual(p.effects, source.effects);
});

test("a single-anchor brush still outlines to its round-cap disk", () => {
  const dot = brush("Dot", {
    anchors: [{ p: { x: 0, y: 0 }, hIn: null, hOut: null, w: 1 }],
  });
  assert.equal(canConvertBrushToOutline(dot), true);
  const p = convertBrushToOutlinePath(dot);
  assert.equal(p.subpaths[0].closed, true);
  assert.ok(p.subpaths[0].anchors.length >= 3);
});

test("an empty brush cannot convert to an outline path", () => {
  const empty = brush("Empty", { anchors: [] });
  assert.equal(canConvertBrushToOutline(empty), false);
  assert.equal(convertBrushToOutlinePath(empty), null);
});

test("brush converts to the filled outline of its envelope", () => {
  const source = brush("Pressure stroke");
  assert.equal(canConvertBrushToOutline(source), true);
  const p = convertBrushToOutlinePath(source);

  // The appearance-preserving direction: a closed ring filled with the brush's
  // stroke paint; stroke and width go inert.
  assert.equal(p.type, "path");
  assert.equal(p.id, source.id);
  assert.equal(p.fillRule, "nonzero");
  assert.equal(p.subpaths.length, 1);
  assert.equal(p.subpaths[0].closed, true);
  assert.ok(p.subpaths[0].anchors.length > source.anchors.length);
  assert.ok(
    p.subpaths[0].anchors.every((a) => a.hIn === null && a.hOut === null)
  );
  assert.deepEqual(p.fill, source.stroke);
  assert.equal(p.stroke, null);
  assert.equal(p.strokeWidth, 0);
  assert.deepEqual(p.transform, source.transform);
  assert.deepEqual(p.effects, source.effects);
});

test("path→brush→path round-trips the centerline in the store", () => {
  const doc = createEmptyDocument();
  doc.nodes.p = path("p", { transform: [...IDENTITY] });
  doc.rootIds = ["p"];

  useEditor.getState().loadDocument(doc);
  useEditor.getState().setSelection(["p"]);
  const historyLength = useEditor.getState().history.past.length;

  useEditor.getState().convertSelectedToBrushes();
  let state = useEditor.getState();
  assert.equal(state.history.past.length, historyLength + 1);
  assert.deepEqual(state.selection, ["p"]);
  assert.equal(state.doc.nodes.p.type, "brush");

  // "Convert to path" is the faithful direction, so it round-trips the brush
  // centerline back to an open path.
  useEditor.getState().convertSelectedToPaths();
  state = useEditor.getState();
  assert.equal(state.doc.nodes.p.type, "path");
  assert.equal(state.doc.nodes.p.subpaths[0].closed, false);
  assert.deepEqual(
    state.doc.nodes.p.subpaths[0].anchors.map((a) => a.p),
    doc.nodes.p.subpaths[0].anchors.map((a) => a.p)
  );

  state.undo();
  assert.equal(useEditor.getState().doc.nodes.p.type, "brush");
  state.undo();
  assert.equal(useEditor.getState().doc.nodes.p.type, "path");
});

test("store converts a brush to a filled outline path in one transaction", () => {
  const doc = createEmptyDocument();
  doc.nodes.b = brush("b");
  doc.rootIds = ["b"];

  useEditor.getState().loadDocument(doc);
  useEditor.getState().setSelection(["b"]);
  const historyLength = useEditor.getState().history.past.length;
  useEditor.getState().convertSelectedBrushesToOutline();

  const state = useEditor.getState();
  assert.equal(state.history.past.length, historyLength + 1);
  assert.equal(state.doc.nodes.b.type, "path");
  assert.equal(state.doc.nodes.b.subpaths[0].closed, true);
  assert.deepEqual(state.doc.nodes.b.fill, doc.nodes.b.stroke);
  assert.equal(state.doc.nodes.b.stroke, null);
});

test("store converts a multi-contour path into a group of brushes", () => {
  const doc = createEmptyDocument();
  doc.nodes.p = path("p", {
    transform: [...IDENTITY],
    subpaths: [openSubpath(), openSubpath()],
  });
  doc.rootIds = ["p"];

  useEditor.getState().loadDocument(doc);
  useEditor.getState().setSelection(["p"]);
  useEditor.getState().convertSelectedToBrushes();

  const state = useEditor.getState();
  assert.equal(state.doc.nodes.p, undefined);
  assert.equal(state.selection.length, 1);
  const group = state.doc.nodes[state.selection[0]];
  assert.equal(group.type, "group");
  assert.equal(group.childIds.length, 2);
  for (const childId of group.childIds) {
    assert.equal(state.doc.nodes[childId].type, "brush");
  }
});
