import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let canCombineSelection;
let combineShapes;
let createEmptyDocument;
let useEditor;
let commands;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ canCombineSelection, combineShapes } = await server.ssrLoadModule(
    "/src/model/path/combinePaths.ts"
  ));
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ COMMANDS: commands } = await server.ssrLoadModule("/src/commands/registry.ts"));
});

after(async () => server.close());

const solid = (color) => ({ type: "solid", color, alpha: 1 });

const pathShape = (id, subpaths, patch = {}) => ({
  id,
  name: id,
  type: "path",
  ...SHAPE_BASE, fillRule: "nonzero",
  ...NODE_BASE,
  subpaths,
  fill: null,
  stroke: solid("#112233"),
  strokeWidth: 3,
  transform: [1, 0, 0, 1, 0, 0],
  transformOrigin: null,
  ...patch,
});

// The case this command exists for: separate open strokes, nowhere near each
// other, so join cannot weld them and a compound path cannot hold them.
const openSeg = (a, b) => ({
  closed: false,
  anchors: [
    { p: a, hIn: null, hOut: { x: a.x + 2, y: a.y } },
    { p: b, hIn: { x: b.x - 2, y: b.y }, hOut: null },
  ],
});

test("concatenates contours without touching geometry", () => {
  const a = pathShape("a", [openSeg({ x: 0, y: 0 }, { x: 10, y: 0 })]);
  const b = pathShape("b", [openSeg({ x: 0, y: 50 }, { x: 10, y: 50 })]);
  const out = combineShapes([a, b]);
  assert.ok(out);
  assert.equal(out.subpaths.length, 2);
  assert.ok(out.subpaths.every((sp) => !sp.closed));
  // Nothing is welded and no anchor moves: the ends stay 50 units apart.
  assert.deepEqual(out.subpaths[0].anchors, a.subpaths[0].anchors);
  assert.deepEqual(out.subpaths[1].anchors, b.subpaths[0].anchors);
  // Baked into parent space with an identity transform, like join/boolean.
  assert.deepEqual(out.transform, [1, 0, 0, 1, 0, 0]);
  assert.notEqual(out.id, a.id);
});

test("maps the other inputs into the backmost input's space, keeping its transform", () => {
  const a = pathShape("a", [openSeg({ x: 0, y: 0 }, { x: 10, y: 0 })]);
  const b = pathShape("b", [openSeg({ x: 0, y: 0 }, { x: 10, y: 0 })], {
    transform: [2, 0, 0, 2, 5, 100],
  });
  const flat = combineShapes([a, b]);
  // "a" is the base and has an identity transform, so this is parent space.
  assert.deepEqual(flat.transform, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(flat.subpaths[1].anchors[0].p, { x: 5, y: 100 });
  assert.deepEqual(flat.subpaths[1].anchors[1].p, { x: 25, y: 100 });
  // Handles ride along with their anchor.
  assert.deepEqual(flat.subpaths[1].anchors[0].hOut, { x: 9, y: 100 });

  // Base first with a scaled transform: the result keeps it and "a" is mapped
  // into it, so the base's own contours and line weight are untouched.
  const scaled = combineShapes([b, a]);
  assert.deepEqual(scaled.transform, b.transform);
  assert.deepEqual(scaled.subpaths[0], b.subpaths[0]);
  assert.deepEqual(scaled.subpaths[1].anchors[0].p, { x: -2.5, y: -50 });
  assert.deepEqual(scaled.subpaths[1].anchors[1].p, { x: 2.5, y: -50 });
});

test("a scaled base keeps its rendered line weight (regression: baked stroke)", () => {
  // strokeWidth is a node-local unit the renderer scales by the transform, so
  // baking a scale away would halve this stroke.
  const base = pathShape("base", [openSeg({ x: 0, y: 0 }, { x: 10, y: 0 })], {
    transform: [2, 0, 0, 2, 0, 0],
    strokeWidth: 3,
    strokeDash: [4, 2],
  });
  const other = pathShape("other", [openSeg({ x: 0, y: 30 }, { x: 10, y: 30 })]);
  const out = combineShapes([base, other]);
  const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  assert.equal(out.strokeWidth * scaleOf(out.transform), 3 * scaleOf(base.transform));
  assert.deepEqual(out.strokeDash, [4, 2]);
});

test("a non-invertible base transform falls back to baking into parent space", () => {
  const degenerate = pathShape("d", [openSeg({ x: 0, y: 0 }, { x: 10, y: 0 })], {
    transform: [0, 0, 0, 0, 7, 9],
  });
  const other = pathShape("o", [openSeg({ x: 0, y: 30 }, { x: 10, y: 30 })]);
  const out = combineShapes([degenerate, other]);
  assert.deepEqual(out.transform, [1, 0, 0, 1, 0, 0]);
  // The degenerate input collapses onto its translation, the other passes through.
  assert.deepEqual(out.subpaths[0].anchors[0].p, { x: 7, y: 9 });
  assert.deepEqual(out.subpaths[1].anchors[0].p, { x: 0, y: 30 });
});

test("appearance comes from the backmost input; effects are dropped", () => {
  const back = pathShape("back", [openSeg({ x: 0, y: 0 }, { x: 10, y: 0 })], {
    stroke: solid("#ff0000"),
    strokeWidth: 7,
    strokeCap: "square",
    fillRule: "evenodd",
    opacity: 0.4,
    blendMode: "multiply",
    effects: [{ type: "blur", radius: 3 }],
  });
  const front = pathShape("front", [openSeg({ x: 0, y: 50 }, { x: 10, y: 50 })], {
    stroke: solid("#00ff00"),
    strokeWidth: 1,
  });
  const out = combineShapes([back, front]);
  assert.deepEqual(out.stroke, back.stroke);
  assert.equal(out.strokeWidth, 7);
  assert.equal(out.strokeCap, "square");
  assert.equal(out.fillRule, "evenodd");
  assert.equal(out.opacity, 0.4);
  assert.equal(out.blendMode, "multiply");
  assert.deepEqual(out.effects, []);
  assert.equal(out.generator, null);
});

test("fewer than two paths cannot be combined", () => {
  const a = pathShape("a", [openSeg({ x: 0, y: 0 }, { x: 10, y: 0 })]);
  assert.equal(combineShapes([a]), null);
  assert.equal(combineShapes([]), null);
});

test("the selection must be two or more sibling paths", () => {
  const doc = createEmptyDocument();
  doc.nodes.a = pathShape("a", [openSeg({ x: 0, y: 0 }, { x: 10, y: 0 })]);
  doc.nodes.b = pathShape("b", [openSeg({ x: 0, y: 50 }, { x: 10, y: 50 })]);
  doc.nodes.g = {
    id: "g", name: "g", type: "group", clipsToMask: false, ...NODE_BASE,
    childIds: ["c"], opacity: 1, transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
  };
  doc.nodes.c = pathShape("c", [openSeg({ x: 0, y: 90 }, { x: 10, y: 90 })]);
  doc.nodes.r = {
    id: "r", name: "r", type: "rect", ...SHAPE_BASE, cornerRadius: 0, ...NODE_BASE,
    x: 0, y: 0, width: 5, height: 5, fill: solid("#fff"),
    transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
  };
  doc.rootIds = ["a", "b", "g", "r"];

  assert.equal(canCombineSelection(doc, ["a", "b"]), true);
  assert.equal(canCombineSelection(doc, ["a"]), false);
  // Different parents.
  assert.equal(canCombineSelection(doc, ["a", "c"]), false);
  // Non-path members: convert to path first.
  assert.equal(canCombineSelection(doc, ["a", "r"]), false);
  assert.equal(canCombineSelection(doc, ["a", "g"]), false);
});

// --- Store integration ----------------------------------------------------

const commandById = (id) => commands.find((command) => command.id === id);

function threeStrokes() {
  const doc = createEmptyDocument();
  doc.nodes.a = pathShape("a", [openSeg({ x: 0, y: 0 }, { x: 10, y: 0 })]);
  doc.nodes.keep = pathShape("keep", [openSeg({ x: 0, y: 20 }, { x: 10, y: 20 })]);
  doc.nodes.b = pathShape("b", [openSeg({ x: 0, y: 50 }, { x: 10, y: 50 })]);
  doc.rootIds = ["a", "keep", "b"];
  return doc;
}

test("the command takes the backmost member's slot and is undoable", () => {
  useEditor.getState().loadDocument(threeStrokes());
  useEditor.getState().setSelection(["b", "a"]);

  const combine = commandById("path.combine");
  assert.ok(combine);
  assert.equal(combine.enabled(useEditor.getState()), true);
  combine.run(useEditor.getState());

  let state = useEditor.getState();
  assert.equal(state.doc.rootIds.length, 2);
  // "a" was backmost, so the result sits behind the untouched "keep".
  const [resultId, keepId] = state.doc.rootIds;
  assert.equal(keepId, "keep");
  const result = state.doc.nodes[resultId];
  assert.equal(result.type, "path");
  assert.equal(result.subpaths.length, 2);
  assert.equal(state.doc.nodes.a, undefined);
  assert.equal(state.doc.nodes.b, undefined);
  assert.deepEqual(state.selection, [resultId]);

  state.undo();
  state = useEditor.getState();
  assert.deepEqual(state.doc.rootIds, ["a", "keep", "b"]);
});

test("combine is the inverse of split: the round trip restores the contours", () => {
  useEditor.getState().loadDocument(threeStrokes());
  useEditor.getState().setSelection(["a", "b"]);
  commandById("path.combine").run(useEditor.getState());
  const combinedId = useEditor.getState().doc.rootIds[0];
  const combined = useEditor.getState().doc.nodes[combinedId];

  // Split wraps the pieces in a group; select them and combine again.
  commandById("path.splitSubpaths").run(useEditor.getState());
  const group = useEditor.getState().doc.nodes[useEditor.getState().doc.rootIds[0]];
  assert.equal(group.type, "group");
  useEditor.getState().setSelection(group.childIds);
  const recombine = commandById("path.combine");
  assert.equal(recombine.enabled(useEditor.getState()), true);
  recombine.run(useEditor.getState());

  const state = useEditor.getState();
  const again = state.doc.nodes[state.doc.nodes[state.doc.rootIds[0]].childIds[0]];
  assert.equal(again.subpaths.length, combined.subpaths.length);
  assert.deepEqual(again.subpaths, combined.subpaths);
});

test("a clipping mask member is refused rather than swallowed", () => {
  const doc = createEmptyDocument();
  doc.nodes.content = pathShape("content", [openSeg({ x: 0, y: 0 }, { x: 40, y: 0 })]);
  doc.nodes.mask = pathShape("mask", [
    {
      closed: true,
      anchors: [
        { p: { x: 0, y: 0 }, hIn: null, hOut: null },
        { p: { x: 20, y: 0 }, hIn: null, hOut: null },
        { p: { x: 20, y: 20 }, hIn: null, hOut: null },
      ],
    },
  ]);
  doc.nodes.clip = {
    id: "clip", name: "clip", type: "group", clipsToMask: true, ...NODE_BASE,
    childIds: ["content", "mask"], opacity: 1,
    transform: [1, 0, 0, 1, 0, 0], transformOrigin: null,
  };
  doc.rootIds = ["clip"];
  useEditor.getState().loadDocument(doc);
  useEditor.getState().setSelection(["content", "mask"]);
  commandById("path.combine").run(useEditor.getState());
  assert.deepEqual(useEditor.getState().doc.nodes.clip.childIds, ["content", "mask"]);
});
