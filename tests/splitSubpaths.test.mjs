import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let canSplitSubpaths;
let splitSubpaths;
let flattenSplitPieces;
let createEmptyDocument;
let useEditor;
let commands;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ canSplitSubpaths, flattenSplitPieces, splitSubpaths } =
    await server.ssrLoadModule("/src/model/path/splitSubpaths.ts"));
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ COMMANDS: commands } = await server.ssrLoadModule("/src/commands/registry.ts"));
});

after(async () => server.close());

const solid = (color) => ({ type: "solid", color, alpha: 1 });

const pathShape = (subpaths, patch = {}) => ({
  id: "p1",
  name: "Ring",
  type: "path",
  ...SHAPE_BASE, fillRule: "evenodd",
  ...NODE_BASE,
  subpaths,
  fill: solid("#ff6633"),
  stroke: solid("#112233"),
  strokeWidth: 3,
  opacity: 0.6,
  blendMode: "multiply",
  transform: [2, 0, 0, 2, 5, 7],
  transformOrigin: null,
  ...patch,
});

const square = (x, y, size) => ({
  closed: true,
  anchors: [
    { p: { x, y }, hIn: null, hOut: null },
    { p: { x: x + size, y }, hIn: null, hOut: null },
    { p: { x: x + size, y: y + size }, hIn: null, hOut: null },
    { p: { x, y: y + size }, hIn: null, hOut: null },
  ],
});

test("splits each contour into its own path, wrapped in one group", () => {
  const shape = pathShape([square(0, 0, 10), square(2, 2, 6)]);
  const out = splitSubpaths(shape);
  assert.ok(out);
  const { group, pieces } = out;
  assert.equal(pieces.length, 2);
  assert.deepEqual(group.childIds, pieces.map((piece) => piece.id));
  assert.equal(group.type, "group");
  assert.equal(group.clipsToMask, false);
  assert.equal(group.name, "Ring");
  for (const piece of pieces) {
    assert.equal(piece.subpaths.length, 1);
    assert.deepEqual(piece.fill, shape.fill);
    assert.equal(piece.strokeWidth, shape.strokeWidth);
    assert.equal(piece.fillRule, shape.fillRule);
    assert.equal(piece.generator, null);
    assert.notEqual(piece.id, shape.id);
    // Everything that composites the shape as a whole moves to the group, so
    // partial opacity does not darken the overlaps and local-unit lengths
    // (blur radii, stroke widths) still scale through the same transform.
    assert.deepEqual(piece.transform, [1, 0, 0, 1, 0, 0]);
    assert.equal(piece.opacity, 1);
    assert.equal(piece.blendMode, "normal");
    assert.deepEqual(piece.effects, []);
  }
  assert.deepEqual(group.transform, shape.transform);
  assert.equal(group.opacity, shape.opacity);
  assert.equal(group.blendMode, shape.blendMode);
  // Back-to-front order matches the source subpath order.
  assert.deepEqual(pieces[0].subpaths[0], shape.subpaths[0]);
  assert.deepEqual(pieces[1].subpaths[0], shape.subpaths[1]);
  assert.deepEqual([pieces[0].name, pieces[1].name], ["Ring 1", "Ring 2"]);
  assert.notEqual(pieces[0].id, pieces[1].id);
});

test("open and closed contours keep their own state; effects ride the group", () => {
  const open = {
    closed: false,
    anchors: [
      { p: { x: 0, y: 0 }, hIn: null, hOut: { x: 3, y: 0 } },
      { p: { x: 10, y: 0 }, hIn: { x: 7, y: 0 }, hOut: null },
    ],
  };
  const effects = [{ id: "fx_blur", enabled: true, type: "blur", radius: 4 }];
  const shape = pathShape([square(0, 0, 10), open], { effects, hidden: true });
  const { group, pieces } = splitSubpaths(shape);
  assert.equal(pieces[0].subpaths[0].closed, true);
  assert.equal(pieces[1].subpaths[0].closed, false);
  assert.deepEqual(pieces[1].subpaths[0].anchors[0].hOut, { x: 3, y: 0 });
  assert.deepEqual(group.effects, effects);
  assert.notEqual(group.effects, effects);
  assert.equal(group.hidden, true);
  assert.ok(pieces.every((piece) => piece.effects.length === 0 && !piece.hidden));
});

test("flattenSplitPieces folds the group's state back onto each piece", () => {
  const shape = pathShape([square(0, 0, 10), square(2, 2, 6)]);
  const out = splitSubpaths(shape);
  const flat = flattenSplitPieces(out);
  assert.equal(flat.length, 2);
  for (const piece of flat) {
    assert.deepEqual(piece.transform, shape.transform);
    assert.equal(piece.opacity, shape.opacity);
    assert.equal(piece.blendMode, shape.blendMode);
  }
});

test("a single-contour path cannot be split", () => {
  const shape = pathShape([square(0, 0, 10)]);
  assert.equal(canSplitSubpaths(shape), false);
  assert.equal(splitSubpaths(shape), null);
  assert.equal(canSplitSubpaths(pathShape([square(0, 0, 10), square(2, 2, 6)])), true);
  assert.equal(canSplitSubpaths(undefined), false);
  assert.equal(canSplitSubpaths({ ...NODE_BASE, id: "g", type: "group", childIds: [] }), false);
});

test("pieces do not share subpath objects with the source", () => {
  const shape = pathShape([square(0, 0, 10), square(2, 2, 6)]);
  const out = splitSubpaths(shape);
  out.pieces[0].subpaths[0].anchors[0].p.x = 99;
  assert.equal(shape.subpaths[0].anchors[0].p.x, 0);
});

// --- Store integration ----------------------------------------------------

test("the command replaces the path in place, keeping z-order, and undoes", () => {
  const doc = createEmptyDocument();
  doc.nodes.ring = pathShape([square(0, 0, 10), square(2, 2, 6)], { id: "ring" });
  doc.nodes.above = pathShape([square(50, 0, 10)], { id: "above", name: "Above" });
  doc.rootIds = ["ring", "above"];
  useEditor.getState().loadDocument(doc);
  useEditor.getState().setSelection(["ring"]);

  const split = commands.find((command) => command.id === "path.splitSubpaths");
  assert.ok(split);
  assert.equal(split.enabled(useEditor.getState()), true);
  split.run(useEditor.getState());

  let state = useEditor.getState();
  // The group takes the source's slot, still behind "above".
  assert.deepEqual(state.doc.rootIds.length, 2);
  assert.equal(state.doc.rootIds[1], "above");
  const groupId = state.doc.rootIds[0];
  const group = state.doc.nodes[groupId];
  assert.equal(state.doc.nodes.ring, undefined);
  assert.equal(group.type, "group");
  assert.equal(group.childIds.length, 2);
  assert.ok(group.childIds.every((id) => state.doc.nodes[id].subpaths.length === 1));
  assert.deepEqual(state.selection, [groupId]);
  // Nothing left to split now that each piece holds one contour.
  assert.equal(split.enabled(state), false);

  state.undo();
  state = useEditor.getState();
  assert.deepEqual(state.doc.rootIds, ["ring", "above"]);
  assert.equal(state.doc.nodes.ring.subpaths.length, 2);
});

test("a clipping mask is left alone: splitting it would rewrite the clip", () => {
  const doc = createEmptyDocument();
  doc.nodes.content = pathShape([square(0, 0, 40)], { id: "content" });
  doc.nodes.mask = pathShape([square(0, 0, 10), square(20, 0, 10)], { id: "mask" });
  doc.nodes.clip = {
    id: "clip",
    name: "Clip Group",
    type: "group",
    clipsToMask: true,
    ...NODE_BASE,
    // The frontmost child is the mask.
    childIds: ["content", "mask"],
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
  };
  doc.rootIds = ["clip"];
  useEditor.getState().loadDocument(doc);
  useEditor.getState().setSelection(["mask"]);

  const split = commands.find((command) => command.id === "path.splitSubpaths");
  split.run(useEditor.getState());
  const state = useEditor.getState();
  assert.deepEqual(state.doc.nodes.clip.childIds, ["content", "mask"]);
  assert.equal(state.doc.nodes.mask.subpaths.length, 2);
});

test("a compound path child splits flat: a compound cannot hold a group", () => {
  const doc = createEmptyDocument();
  doc.nodes.c1 = pathShape([square(0, 0, 10), square(20, 0, 10)], { id: "c1" });
  doc.nodes.c2 = pathShape([square(40, 0, 10)], { id: "c2" });
  doc.nodes.comp = {
    id: "comp",
    name: "Compound Path",
    type: "compoundPath",
    ...SHAPE_BASE,
    ...NODE_BASE,
    childIds: ["c1", "c2"],
    fill: solid("#ff0000"),
    stroke: null,
    strokeWidth: 0,
    opacity: 1,
    blendMode: "normal",
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
  };
  delete doc.nodes.comp.fillRule;
  doc.rootIds = ["comp"];
  useEditor.getState().loadDocument(doc);
  useEditor.getState().setSelection(["c1"]);

  const split = commands.find((command) => command.id === "path.splitSubpaths");
  split.run(useEditor.getState());
  const state = useEditor.getState();
  const children = state.doc.nodes.comp.childIds;
  assert.equal(children.length, 3);
  assert.equal(children[2], "c2");
  assert.ok(children.every((id) => state.doc.nodes[id].type === "path"));
  assert.deepEqual(state.selection, [children[0], children[1]]);
});
