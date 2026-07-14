import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let hasUnsavedChanges;
let useEditor;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ hasUnsavedChanges, useEditor } =
    await server.ssrLoadModule("/src/store/editorStore.ts"));
});

beforeEach(() => {
  useEditor.getState().newDocument();
});

after(async () => server.close());

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

const textShape = (id, patch = {}) => ({
  ...rect(id),
  type: "text",
  text: "Hello",
  textMode: "point",
  x: 10,
  y: 20,
  width: 1,
  height: 1,
  fontFamily: "System Sans",
  fontSize: 24,
  fontWeight: 400,
  italic: false,
  lineHeight: 1.2,
  align: "left",
  ...patch,
});

test("history patches omit unchanged document payloads", () => {
  const doc = createEmptyDocument();
  const asset = {
    id: "asset-1",
    kind: "image",
    mimeType: "image/png",
    source: { type: "data", data: "data:image/png;base64,large-payload" },
  };
  doc.assets[asset.id] = asset;
  useEditor.getState().loadDocument(doc);

  useEditor.getState().addArtboard({ x: 50, y: 50 });

  const entry = useEditor.getState().history.past.at(-1);
  assert.ok(entry.patches.length);
  assert.equal(JSON.stringify(entry).includes("large-payload"), false);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.assets[asset.id], asset);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.assets[asset.id], asset);
});

test("undo and redo return to the correct saved revision", () => {
  const saved = useEditor.getState().doc;
  useEditor.getState().addShape(rect("rect-1"));
  assert.equal(hasUnsavedChanges(useEditor.getState()), true);

  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, saved);
  assert.equal(hasUnsavedChanges(useEditor.getState()), false);

  useEditor.getState().redo();
  assert.equal(hasUnsavedChanges(useEditor.getState()), true);
  useEditor.getState().markSaved();
  assert.equal(hasUnsavedChanges(useEditor.getState()), false);

  useEditor.getState().undo();
  assert.equal(hasUnsavedChanges(useEditor.getState()), true);
  useEditor.getState().redo();
  assert.equal(hasUnsavedChanges(useEditor.getState()), false);
});

test("recovered work remains dirty after an edit is undone", () => {
  const recovered = createEmptyDocument();
  useEditor.getState().recoverDocument(recovered);
  assert.equal(hasUnsavedChanges(useEditor.getState()), true);

  useEditor.getState().addShape(rect("rect-1"));
  useEditor.getState().undo();

  assert.deepEqual(useEditor.getState().doc, recovered);
  assert.equal(hasUnsavedChanges(useEditor.getState()), true);
});

test("an interaction commits once and cancel restores its immutable start", () => {
  useEditor.getState().addShape(rect("rect-1"));
  const before = useEditor.getState().doc;
  const historyLength = useEditor.getState().history.past.length;

  useEditor.getState().beginInteraction();
  useEditor.getState().endInteraction();
  assert.equal(useEditor.getState().history.past.length, historyLength);

  useEditor.getState().beginInteraction();
  useEditor.getState().applyShapes({
    "rect-1": { ...before.nodes["rect-1"], x: 30 },
  });
  assert.equal(useEditor.getState().history.past.length, historyLength);
  useEditor.getState().endInteraction();

  assert.equal(useEditor.getState().history.past.length, historyLength + 1);
  assert.equal(useEditor.getState().doc.nodes["rect-1"].x, 30);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["rect-1"].x, 0);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes["rect-1"].x, 30);

  const committed = useEditor.getState().doc;
  const committedHistoryLength = useEditor.getState().history.past.length;
  useEditor.getState().beginInteraction();
  useEditor.getState().applyShapes({
    "rect-1": { ...committed.nodes["rect-1"], x: 60 },
  });
  useEditor.getState().cancelInteraction();

  assert.equal(useEditor.getState().doc, committed);
  assert.equal(useEditor.getState().history.past.length, committedHistoryLength);
  assert.equal(useEditor.getState()._interaction, null);
});

test("a new transaction after undo discards the redo branch", () => {
  useEditor.getState().addShape(rect("rect-1"));
  useEditor.getState().undo();
  assert.equal(useEditor.getState().history.future.length, 1);

  useEditor.getState().addShape(rect("rect-2"));
  assert.equal(useEditor.getState().history.future.length, 0);
  useEditor.getState().redo();

  const doc = useEditor.getState().doc;
  assert.equal(doc.nodes["rect-1"], undefined);
  assert.ok(doc.nodes["rect-2"]);
});

test("cancelled and empty interactions preserve redo while a commit clears it", () => {
  useEditor.getState().addShape(rect("rect-1"));
  useEditor.getState().updateShape(rect("rect-1", { x: 10 }));
  useEditor.getState().undo();
  assert.equal(useEditor.getState().history.future.length, 1);

  const before = useEditor.getState().doc;
  useEditor.getState().beginInteraction();
  useEditor.getState().applyShapes({ "rect-1": { ...before.nodes["rect-1"], x: 20 } });
  useEditor.getState().cancelInteraction();
  assert.equal(useEditor.getState().history.future.length, 1);

  useEditor.getState().beginInteraction();
  useEditor.getState().endInteraction();
  assert.equal(useEditor.getState().history.future.length, 1);

  useEditor.getState().beginInteraction();
  useEditor.getState().applyShapes({ "rect-1": { ...before.nodes["rect-1"], x: 30 } });
  useEditor.getState().endInteraction();
  assert.equal(useEditor.getState().history.future.length, 0);
});

test("undo first cancels an active interaction", () => {
  useEditor.getState().addShape(rect("rect-1"));
  const before = useEditor.getState().doc;
  const historyLength = useEditor.getState().history.past.length;

  useEditor.getState().beginInteraction();
  useEditor.getState().applyShapes({
    "rect-1": { ...before.nodes["rect-1"], x: 30 },
  });
  useEditor.getState().undo();

  assert.equal(useEditor.getState().doc, before);
  assert.equal(useEditor.getState().history.past.length, historyLength);
  assert.equal(useEditor.getState()._interaction, null);

  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["rect-1"], undefined);
});

test("a transaction finalizes an active interaction as a separate step", () => {
  useEditor.getState().addShape(rect("rect-1"));
  const before = useEditor.getState().doc;
  const historyLength = useEditor.getState().history.past.length;

  useEditor.getState().beginInteraction();
  useEditor.getState().applyShapes({
    "rect-1": { ...before.nodes["rect-1"], x: 30 },
  });
  useEditor.getState().updateShape(rect("rect-1", { x: 90 }));

  assert.equal(useEditor.getState().doc.nodes["rect-1"].x, 90);
  assert.equal(useEditor.getState().history.past.length, historyLength + 2);
  assert.equal(useEditor.getState()._interaction, null);

  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["rect-1"].x, 30);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
});

test("coalescing stays within one target and one saved revision", () => {
  useEditor.getState().addShapes([rect("rect-1"), rect("rect-2")]);
  useEditor.getState().setSelection(["rect-1"]);
  const beforeFirst = useEditor.getState().history.past.length;
  useEditor.getState().updateSelectedStyle({ opacity: 0.8 });
  useEditor.getState().updateSelectedStyle({ opacity: 0.6 });
  assert.equal(useEditor.getState().history.past.length, beforeFirst + 1);
  assert.equal(JSON.stringify(useEditor.getState().history.past.at(-1)).includes("\"opacity\":0.8"), false);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["rect-1"].opacity, 1);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes["rect-1"].opacity, 0.6);

  useEditor.getState().setSelection(["rect-2"]);
  useEditor.getState().updateSelectedStyle({ opacity: 0.4 });
  assert.equal(
    useEditor.getState().history.past.length,
    beforeFirst + 2,
    "the same field on another selection is a separate undo step"
  );

  useEditor.getState().markSaved();
  const saved = useEditor.getState().doc;
  useEditor.getState().updateSelectedStyle({ opacity: 0.2 });
  assert.equal(useEditor.getState().history.past.length, beforeFirst + 3);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, saved);
  assert.equal(hasUnsavedChanges(useEditor.getState()), false);
});

test("loading a document resets the previous coalescing window", () => {
  useEditor.getState().addShape(rect("rect-1"));
  useEditor.getState().updateSelectedStyle({ opacity: 0.8 });

  const loaded = createEmptyDocument();
  loaded.nodes["rect-1"] = rect("rect-1");
  loaded.rootIds = ["rect-1"];
  useEditor.getState().loadDocument(loaded);
  useEditor.getState().setSelection(["rect-1"]);
  useEditor.getState().updateSelectedStyle({ opacity: 0.5 });

  assert.equal(useEditor.getState().history.past.length, 1);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, loaded);
});

test("the same coalesce key starts a new entry after the window expires", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    useEditor.getState().addShape(rect("rect-1"));
    const historyLength = useEditor.getState().history.past.length;
    useEditor.getState().updateSelectedStyle({ opacity: 0.8 });
    mock.timers.tick(600);
    useEditor.getState().updateSelectedStyle({ opacity: 0.6 });

    assert.equal(useEditor.getState().history.past.length, historyLength + 2);
    useEditor.getState().undo();
    assert.equal(useEditor.getState().doc.nodes["rect-1"].opacity, 0.8);
  } finally {
    useEditor.getState().newDocument();
    mock.timers.reset();
  }
});

test("setDoc interaction stores only the final artboard document", () => {
  const before = useEditor.getState().doc;
  const historyLength = useEditor.getState().history.past.length;
  const intermediate = { id: "board-1", name: "Board", x: 20, y: 0, width: 100, height: 100, background: "#ffffff" };
  const final = { ...intermediate, x: 40 };

  useEditor.getState().beginInteraction();
  useEditor.getState().setDoc({ ...before, artboards: [intermediate] });
  useEditor.getState().setDoc({ ...before, artboards: [final] });
  useEditor.getState().endInteraction();

  assert.equal(useEditor.getState().history.past.length, historyLength + 1);
  assert.equal(JSON.stringify(useEditor.getState().history.past.at(-1)).includes("\"x\":20"), false);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.artboards, []);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc.artboards, [final]);
});

test("a branch at the same history depth does not collide with the saved revision", () => {
  useEditor.getState().addShape(rect("rect-1"));
  useEditor.getState().markSaved();
  useEditor.getState().undo();
  useEditor.getState().addShape(rect("rect-2"));

  assert.equal(useEditor.getState().history.past.length, 1);
  assert.equal(hasUnsavedChanges(useEditor.getState()), true);
});

test("document-only maintenance survives undo and redo without adding an entry", () => {
  useEditor.getState().addShape(rect("rect-1"));
  const historyLength = useEditor.getState().history.past.length;
  useEditor.getState().setGridSize(25);

  assert.equal(useEditor.getState().history.past.length, historyLength);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["rect-1"], undefined);
  assert.equal(useEditor.getState().doc.settings.gridSize, 25);
  assert.equal(hasUnsavedChanges(useEditor.getState()), true);

  useEditor.getState().redo();
  assert.ok(useEditor.getState().doc.nodes["rect-1"]);
  assert.equal(useEditor.getState().doc.settings.gridSize, 25);
  useEditor.getState().markSaved();
  assert.equal(hasUnsavedChanges(useEditor.getState()), false);
  useEditor.getState().undo();
  assert.equal(hasUnsavedChanges(useEditor.getState()), true);
  useEditor.getState().redo();
  assert.equal(hasUnsavedChanges(useEditor.getState()), false);
});

test("font maintenance does not terminate an active interaction", () => {
  useEditor.getState().addShapes([rect("rect-1"), textShape("text-1")]);
  const before = useEditor.getState().doc;
  const historyLength = useEditor.getState().history.past.length;

  useEditor.getState().beginInteraction();
  useEditor.getState().applyShapes({ "rect-1": { ...before.nodes["rect-1"], x: 20 } });
  useEditor.getState().remeasureTextShapes();
  assert.notEqual(useEditor.getState()._interaction, null);
  assert.notEqual(useEditor.getState().doc.nodes["text-1"].width, 1);
  useEditor.getState().applyShapes({ "rect-1": { ...useEditor.getState().doc.nodes["rect-1"], x: 40 } });
  useEditor.getState().endInteraction();

  const measuredWidth = useEditor.getState().doc.nodes["text-1"].width;
  assert.equal(useEditor.getState().history.past.length, historyLength + 1);
  assert.equal(useEditor.getState().doc.nodes["rect-1"].x, 40);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["rect-1"].x, 0);
  assert.equal(useEditor.getState().doc.nodes["text-1"].width, measuredWidth);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes["rect-1"].x, 40);
  assert.equal(useEditor.getState().doc.nodes["text-1"].width, measuredWidth);
});

test("same-node maintenance cannot make a different document look saved", () => {
  useEditor.getState().addShape(textShape("text-1"));
  useEditor.getState().remeasureTextShapes();
  useEditor.getState().markSaved();
  const savedWidth = useEditor.getState().savedDoc.nodes["text-1"].width;

  useEditor.getState().undo();
  useEditor.getState().redo();

  assert.notEqual(useEditor.getState().doc.nodes["text-1"].width, savedWidth);
  assert.equal(hasUnsavedChanges(useEditor.getState()), true);
  useEditor.getState().remeasureTextShapes();
  assert.equal(useEditor.getState().doc.nodes["text-1"].width, savedWidth);
  assert.equal(hasUnsavedChanges(useEditor.getState()), false);
});

test("overlapping maintenance is cancelled with its interaction", () => {
  useEditor.getState().addShape(textShape("text-1"));
  useEditor.getState().markSaved();
  const saved = useEditor.getState().savedDoc;

  useEditor.getState().beginInteraction();
  useEditor.getState().applyShapes({ "text-1": { ...saved.nodes["text-1"], x: 40 } });
  useEditor.getState().remeasureTextShapes();
  assert.notEqual(useEditor.getState()._interaction, null);
  assert.notEqual(useEditor.getState().doc.nodes["text-1"].width, saved.nodes["text-1"].width);
  useEditor.getState().cancelInteraction();

  assert.equal(useEditor.getState().doc, saved);
  assert.equal(hasUnsavedChanges(useEditor.getState()), false);
});
