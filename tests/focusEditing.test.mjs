// Focus (isolation) editing of ordinary containers: entering/leaving, and the
// coordinate handling that keeps content drawn inside a moved container from
// jumping when it is committed. See docs/focus.md.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let useEditor;
let currentFocusRoot;
let nodeWorldBounds;
let parentIdOf;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ useEditor, currentFocusRoot } = await server.ssrLoadModule(
    "/src/store/editorStore.ts"
  ));
  ({ nodeWorldBounds } = await server.ssrLoadModule(
    "/src/model/geometry/bounds.ts"
  ));
  ({ parentIdOf } = await server.ssrLoadModule("/src/model/scene.ts"));
});

after(async () => {
  await server.close();
});

const IDENTITY = [1, 0, 0, 1, 0, 0];

const rect = (id, x, y, width = 10, height = 10) => ({
  id,
  name: id,
  type: "rect",
  ...SHAPE_BASE,
  cornerRadius: 0,
  ...NODE_BASE,
  x,
  y,
  width,
  height,
  fill: { type: "solid", color: "#ff0000", alpha: 1 },
  transform: [...IDENTITY],
});

/** A group holding two rects, translated by (100, 50) in world space. */
function makeMovedGroup() {
  const s = useEditor.getState();
  s.newDocument();
  s.addShape(rect("r1", 0, 0));
  s.addShape(rect("r2", 20, 0));
  useEditor.getState().setSelection(["r1", "r2"]);
  useEditor.getState().groupSelected();
  const groupId = useEditor.getState().selection[0];
  // Move the group so its world matrix is not identity.
  useEditor
    .getState()
    .updateNodeStyle(groupId, { transform: [1, 0, 0, 1, 100, 50] });
  return groupId;
}

test("focus enters containers, only ever deeper, and refuses non-containers", () => {
  const groupId = makeMovedGroup();
  let s = useEditor.getState();

  assert.equal(currentFocusRoot(s), null);
  // A leaf is not a container.
  s.enterFocus("r1");
  assert.equal(currentFocusRoot(useEditor.getState()), null);

  s.enterFocus(groupId);
  assert.equal(currentFocusRoot(useEditor.getState()), groupId);
  // Entering clears the selection and the drill.
  assert.deepEqual(useEditor.getState().selection, []);

  // Nest a group inside the focused one, then focus that: the stack deepens.
  useEditor.getState().setSelection(["r1", "r2"]);
  useEditor.getState().groupSelected();
  const innerGroup = useEditor.getState().selection[0];
  useEditor.getState().enterFocus(innerGroup);
  assert.deepEqual(useEditor.getState().focusStack, [groupId, innerGroup]);

  // Stepping back out to an ancestor is not "deeper", so it is refused; the
  // way out is exitFocus, which keeps the breadcrumb a real path.
  useEditor.getState().enterFocus(groupId);
  assert.deepEqual(useEditor.getState().focusStack, [groupId, innerGroup]);

  useEditor.getState().exitFocus();
  assert.equal(currentFocusRoot(useEditor.getState()), groupId);
  useEditor.getState().exitFocus();
  assert.equal(currentFocusRoot(useEditor.getState()), null);
});

test("a shape added inside a focused container keeps its world position", () => {
  const groupId = makeMovedGroup();
  useEditor.getState().enterFocus(groupId);

  // Tools build shapes in world space; committing must not shift them by the
  // container's transform.
  useEditor.getState().addShape(rect("r9", 200, 200));
  const s = useEditor.getState();
  assert.equal(parentIdOf(s.doc, "r9"), groupId);
  const bounds = nodeWorldBounds(s.doc, "r9");
  assert.equal(bounds.x, 200);
  assert.equal(bounds.y, 200);
  // The stored transform absorbed the container's inverse world matrix.
  assert.deepEqual(s.doc.nodes.r9.transform, [1, 0, 0, 1, -100, -50]);

  useEditor.getState().exitFocus();
});

test("pasting inside a focused container keeps the world position too", () => {
  const groupId = makeMovedGroup();
  let s = useEditor.getState();
  s.addShape(rect("r5", 300, 300));
  useEditor.getState().setSelection(["r5"]);
  useEditor.getState().copySelected();

  useEditor.getState().enterFocus(groupId);
  useEditor.getState().paste({ x: 400, y: 400 });
  s = useEditor.getState();
  const pastedId = s.selection[0];
  assert.equal(parentIdOf(s.doc, pastedId), groupId);
  const bounds = nodeWorldBounds(s.doc, pastedId);
  assert.equal(bounds.x + bounds.width / 2, 400);
  assert.equal(bounds.y + bounds.height / 2, 400);

  useEditor.getState().exitFocus();
});

test("undo that removes the focused container leaves the focus stack", () => {
  const groupId = makeMovedGroup();
  useEditor.getState().enterFocus(groupId);
  assert.equal(currentFocusRoot(useEditor.getState()), groupId);

  // Undo past the group's creation: the container no longer exists.
  useEditor.getState().undo();
  useEditor.getState().undo();
  const s = useEditor.getState();
  assert.equal(s.doc.nodes[groupId], undefined);
  assert.equal(currentFocusRoot(s), null);
});

test("frames cannot be created from inside a focus scope", () => {
  const groupId = makeMovedGroup();
  useEditor.getState().enterFocus(groupId);
  const before = Object.keys(useEditor.getState().doc.nodes).length;
  useEditor.getState().addFrame({ x: 0, y: 0 });
  assert.equal(Object.keys(useEditor.getState().doc.nodes).length, before);
  useEditor.getState().exitFocus();
  useEditor.getState().addFrame({ x: 0, y: 0 });
  assert.ok(Object.keys(useEditor.getState().doc.nodes).length > before);
});
