import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer } from "vite";

let server;
let useEditor;
let artboardContentIds;

const rect = (id, patch = {}) => ({
  id,
  name: id,
  type: "rect",
  x: 0,
  y: 0,
  width: 20,
  height: 10,
  fill: { type: "solid", color: "#111111", alpha: 1 },
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
  transform: [1, 0, 0, 1, 0, 0],
  transformOrigin: null,
  ...patch,
});

/** Add a board with exact bounds and return its id. */
const addBoard = (x, y, w, h) => {
  useEditor.getState().addArtboard({ x: x + w / 2, y: y + h / 2 });
  const id = useEditor.getState().selectedArtboardId;
  useEditor.getState().updateArtboard(id, { x, y, width: w, height: h });
  return id;
};

const boardById = (id) =>
  useEditor.getState().doc.artboards.find((ab) => ab.id === id);

const rects = () =>
  Object.values(useEditor.getState().doc.nodes).filter((n) => n.type === "rect");

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ artboardContentIds } = await server.ssrLoadModule(
    "/src/store/artboardSlice.ts"
  ));
});

beforeEach(() => useEditor.getState().newDocument());

after(async () => server.close());

// ---- artboardContentIds -----------------------------------------------------

test("artboardContentIds returns every overlapping root (incl. locked)", () => {
  useEditor.getState().addShape(rect("inside", { x: 10, y: 10, width: 20, height: 10 }));
  useEditor.getState().addShape(rect("outside", { x: 500, y: 10 }));
  // Straddles the right edge — overlapping counts (unlike full containment).
  useEditor.getState().addShape(rect("straddle", { x: 90, y: 10, width: 40, height: 10 }));
  // Locked artwork rides along with its board too.
  useEditor.getState().addShape(rect("locked", { x: 20, y: 40, width: 10, height: 10, locked: true }));
  const board = boardById(addBoard(0, 0, 100, 100));
  assert.deepEqual(
    artboardContentIds(useEditor.getState().doc, board).sort(),
    ["inside", "locked", "straddle"]
  );
});

// ---- duplicateArtboard ------------------------------------------------------

test("duplicateArtboard clones the board and its artwork beside the original", () => {
  useEditor.getState().addShape(rect("inside", { x: 10, y: 10, width: 20, height: 10 }));
  const boardId = addBoard(0, 0, 100, 100);
  useEditor.getState().duplicateArtboard(boardId);

  const doc = useEditor.getState().doc;
  assert.equal(doc.artboards.length, 2);
  // The copy sits right after the source (export order), beside it (width + gap).
  const copy = doc.artboards[1];
  assert.equal(copy.x, 140);
  assert.equal(copy.y, 0);
  assert.equal(copy.width, 100);
  assert.equal(copy.height, 100);
  assert.equal(useEditor.getState().selectedArtboardId, copy.id);

  // The contained rect is cloned and shifted by the same delta as the board.
  assert.equal(rects().length, 2);
  const clone = rects().find((r) => r.id !== "inside");
  assert.equal(clone.transform[4], 140);
  assert.equal(clone.transform[5], 0);
});

test("duplicateArtboard leaves artwork outside the board untouched", () => {
  useEditor.getState().addShape(rect("outside", { x: 500, y: 500 }));
  const boardId = addBoard(0, 0, 100, 100);
  useEditor.getState().duplicateArtboard(boardId);
  // Board duplicated, but no new artwork (nothing was contained).
  assert.equal(useEditor.getState().doc.artboards.length, 2);
  assert.equal(rects().length, 1);
});

test("duplicateArtboard works for an empty board", () => {
  const boardId = addBoard(0, 0, 100, 100);
  useEditor.getState().duplicateArtboard(boardId);
  assert.equal(useEditor.getState().doc.artboards.length, 2);
});

test("duplicateArtboard is a single undoable step", () => {
  useEditor.getState().addShape(rect("inside", { x: 10, y: 10, width: 20, height: 10 }));
  const boardId = addBoard(0, 0, 100, 100);
  const before = useEditor.getState().doc;
  useEditor.getState().duplicateArtboard(boardId);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
});
