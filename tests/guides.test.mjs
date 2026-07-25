import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let parseDocument;
let serializeDocument;
let computeSnap;
let snapPoint;
let guidePositions;
let pickGuide;
let guideSegment;
let activeGuideLines;
let niceStep;
let rulerAxis;
let rulerOrigin;
let rulerBandAt;
let overRulers;
let RULER_SIZE;
let useEditor;
let commands;
let worldPerUnit;
let usePreferences;

const near = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

const viewport = (scale = 1, offset = { x: 0, y: 0 }, rotation = 0) => ({
  scale,
  rotation,
  offset,
});

const box = (x, y, width, height) => ({ x, y, width, height });

const noTargets = { x: [], y: [] };

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
  ({ parseDocument, serializeDocument } = await server.ssrLoadModule(
    "/src/io/serialize.ts"
  ));
  ({ computeSnap, snapPoint, guidePositions } = await server.ssrLoadModule(
    "/src/model/geometry/snap.ts"
  ));
  ({ pickGuide, guideSegment, activeGuideLines } = await server.ssrLoadModule(
    "/src/canvas/guides.ts"
  ));
  ({ niceStep, rulerAxis, rulerOrigin, rulerBandAt, overRulers, RULER_SIZE } =
    await server.ssrLoadModule("/src/canvas/rulers.ts"));
  ({ useEditor } = await server.ssrLoadModule("/src/store/editorStore.ts"));
  ({ COMMANDS: commands } = await server.ssrLoadModule(
    "/src/commands/registry.ts"
  ));
  ({ worldPerUnit } = await server.ssrLoadModule("/src/model/units.ts"));
  ({ usePreferences } = await server.ssrLoadModule("/src/store/preferencesStore.ts"));
});

after(async () => server.close());

// ---- model / serialization -------------------------------------------------

test("guides round-trip through save and load", () => {
  const doc = createEmptyDocument();
  doc.guides = [
    { id: "guide_a", axis: "x", position: 120 },
    { id: "guide_b", axis: "y", position: -40.5 },
  ];
  const parsed = parseDocument(serializeDocument(doc));
  assert.deepEqual(parsed.guides, doc.guides);
});

test("malformed and duplicate guides are rejected", () => {
  const base = createEmptyDocument();
  const withGuides = (guides) => {
    const doc = { ...base, guides };
    return () => parseDocument(serializeDocument(doc));
  };
  assert.throws(withGuides([{ id: "a", axis: "z", position: 0 }]));
  assert.throws(withGuides([{ id: "a", axis: "x", position: "10" }]));
  assert.throws(withGuides([{ axis: "x", position: 10 }]));
  // Ids address a guide for move/delete, so duplicates are a hard error.
  assert.throws(
    withGuides([
      { id: "a", axis: "x", position: 0 },
      { id: "a", axis: "y", position: 0 },
    ]),
    /duplicate/
  );
});

// ---- snapping ---------------------------------------------------------------

test("a moving box snaps its edges and centre to guides", () => {
  const guideLines = guidePositions([
    { id: "g", axis: "x", position: 100 },
    { id: "h", axis: "y", position: 200 },
  ]);
  const ctx = { targets: noTargets, boxes: [], gridSize: null, guideLines };
  // Left edge 3 units short of the vertical guide, bottom edge 2 past it.
  const snap = computeSnap(box(97, 158, 40, 40), ctx, 6);
  near(snap.dx, 3);
  near(snap.dy, 2);
  // Feedback is drawn over the moving box only, not as an infinite line.
  const guide = snap.guides.find((g) => g.axis === "x");
  assert.ok(guide);
  near(guide.value, 100);
  assert.ok(Number.isFinite(guide.from) && Number.isFinite(guide.to));
});

test("guide snapping is skipped when no guides are offered", () => {
  const ctx = { targets: noTargets, boxes: [], gridSize: null, guideLines: noTargets };
  const snap = computeSnap(box(97, 97, 10, 10), ctx, 6);
  near(snap.dx, 0);
  near(snap.dy, 0);
  assert.equal(snap.guides.length, 0);
});

test("point snapping (creation, resize, guide drag) also sees guides", () => {
  const guideLines = guidePositions([{ id: "g", axis: "x", position: 50 }]);
  const res = snapPoint({ x: 47, y: 10 }, { targets: noTargets, gridSize: null, guideLines }, 6);
  near(res.point.x, 50);
  near(res.point.y, 10);
  // Out of range: untouched.
  const far = snapPoint({ x: 30, y: 10 }, { targets: noTargets, gridSize: null, guideLines }, 6);
  near(far.point.x, 30);
});

test("hidden guides and a disabled toggle offer no snap targets", () => {
  const doc = createEmptyDocument();
  doc.guides = [{ id: "g", axis: "x", position: 10 }];
  assert.deepEqual(
    activeGuideLines({ doc, guideSnap: true, guidesVisible: true }),
    { x: [10], y: [] }
  );
  assert.deepEqual(
    activeGuideLines({ doc, guideSnap: true, guidesVisible: false }),
    { x: [], y: [] }
  );
  assert.deepEqual(
    activeGuideLines({ doc, guideSnap: false, guidesVisible: true }),
    { x: [], y: [] }
  );
});

// ---- canvas geometry --------------------------------------------------------

test("a guide's screen segment spans the canvas and answers hit-tests", () => {
  const doc = createEmptyDocument();
  doc.guides = [{ id: "g", axis: "x", position: 100 }];
  const vp = viewport(2, { x: 10, y: 0 });
  const size = { width: 800, height: 600 };
  const { a, b } = guideSegment(vp, doc.guides[0], size);
  // Vertical world line stays vertical on screen, at 100*2 + 10.
  near(a.x, 210);
  near(b.x, 210);
  assert.ok(a.y < 0 && b.y > size.height);

  assert.equal(pickGuide(doc, vp, { x: 212, y: 300 }, size, 4)?.id, "g");
  assert.equal(pickGuide(doc, vp, { x: 220, y: 300 }, size, 4), null);
});

test("guide hit-testing works under canvas rotation", () => {
  const doc = createEmptyDocument();
  doc.guides = [{ id: "g", axis: "y", position: 0 }];
  const vp = viewport(1, { x: 0, y: 0 }, Math.PI / 4);
  const size = { width: 400, height: 400 };
  // A world-horizontal guide through the origin runs diagonally on screen.
  assert.equal(pickGuide(doc, vp, { x: 100, y: 100 }, size, 4)?.id, "g");
  assert.equal(pickGuide(doc, vp, { x: 100, y: 130 }, size, 4), null);
});

test("ruler bands map to a world axis only when the view is axis-aligned", () => {
  const straight = viewport(2, { x: 40, y: 10 });
  const top = rulerAxis(straight, true);
  assert.equal(top.axis, "x");
  near(top.scale, 0.5);
  near(top.origin, -20);
  const left = rulerAxis(straight, false);
  assert.equal(left.axis, "y");
  near(left.scale, 0.5);

  // A quarter turn swaps which world axis each band measures.
  const quarter = rulerAxis(viewport(1, { x: 0, y: 0 }, Math.PI / 2), true);
  assert.equal(quarter.axis, "y");
  // An arbitrary rotation has no meaningful tick spacing.
  assert.equal(rulerAxis(viewport(1, { x: 0, y: 0 }, 0.4), true), null);
});

test("the mirrored view reverses the ruler direction", () => {
  const map = rulerAxis({ ...viewport(1), flipX: true }, true);
  assert.equal(map.axis, "x");
  assert.ok(map.scale < 0);
});

test("tick steps are 1/2/5 x 10^n and never smaller than asked", () => {
  assert.equal(niceStep(0.9), 1);
  assert.equal(niceStep(1), 1);
  assert.equal(niceStep(1.1), 2);
  assert.equal(niceStep(3), 5);
  assert.equal(niceStep(6), 10);
  assert.equal(niceStep(0.03), 0.05);
  // Degenerate input must not produce a zero step (the tick loop would hang).
  assert.equal(niceStep(0), 1);
  assert.equal(niceStep(NaN), 1);
});

test("the ruler origin is the active frame's top-left corner", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.addFrame({ x: 300, y: 200 });
  const { doc, activeFrameId } = useEditor.getState();
  const frame = doc.nodes[activeFrameId];
  assert.equal(frame.type, "frame");
  assert.deepEqual(rulerOrigin(doc, activeFrameId), {
    x: frame.transform[4],
    y: frame.transform[5],
  });
  // No active frame, or a stale id after a delete: back to the world origin.
  assert.deepEqual(rulerOrigin(doc, null), { x: 0, y: 0 });
  assert.deepEqual(rulerOrigin(doc, "frame_gone"), { x: 0, y: 0 });
});

test("the active frame follows selection, not panning", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.addFrame({ x: 0, y: 0 });
  const first = useEditor.getState().activeFrameId;
  editor.addFrame({ x: 900, y: 0 });
  const second = useEditor.getState().activeFrameId;
  assert.ok(first && second && first !== second);

  // Panning/zooming must not touch it.
  useEditor.getState().setViewport(viewport(3, { x: -900, y: -400 }));
  assert.equal(useEditor.getState().activeFrameId, second);

  // Selecting the other frame does.
  useEditor.getState().setSelection([first]);
  assert.equal(useEditor.getState().activeFrameId, first);

  // Deselecting keeps it: an empty selection says nothing about where the
  // user is working.
  useEditor.getState().clearSelection();
  assert.equal(useEditor.getState().activeFrameId, first);

  // Selecting something outside every frame also keeps it.
  useEditor.getState().addShape({
    ...useEditor.getState().doc.nodes[first],
    id: "loose",
    type: "rect",
    x: 2000,
    y: 2000,
    width: 10,
    height: 10,
    cornerRadius: 0,
    childIds: undefined,
  });
  assert.equal(useEditor.getState().activeFrameId, first);
});

test("selecting a node inside a frame activates that frame", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.addFrame({ x: 500, y: 500 });
  const frameId = useEditor.getState().activeFrameId;
  // A shape parented into the frame.
  const rect = {
    id: "child",
    name: "child",
    type: "rect",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    cornerRadius: 0,
    fill: null,
    stroke: null,
    strokeWidth: 0,
    strokeDash: [],
    strokeDashOffset: 0,
    strokeCap: "round",
    strokeJoin: "round",
    strokeAlignment: "center",
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
    opacity: 1,
    blendMode: "normal",
    effects: [],
    hidden: false,
    locked: false,
    generator: null,
  };
  const doc = useEditor.getState().doc;
  useEditor.getState().loadDocument({
    ...doc,
    nodes: {
      ...doc.nodes,
      child: rect,
      [frameId]: { ...doc.nodes[frameId], childIds: ["child"] },
    },
  });
  assert.equal(useEditor.getState().activeFrameId, null);
  useEditor.getState().setSelection(["child"]);
  assert.equal(useEditor.getState().activeFrameId, frameId);
});

test("ruler bands claim their edges but not the corner box", () => {
  const size = { width: 500, height: 400 };
  assert.equal(rulerBandAt({ x: 100, y: 5 }, size), "horizontal");
  assert.equal(rulerBandAt({ x: 5, y: 100 }, size), "vertical");
  assert.equal(rulerBandAt({ x: 5, y: 5 }, size), null);
  assert.equal(rulerBandAt({ x: 100, y: RULER_SIZE + 1 }, size), null);
  assert.equal(overRulers({ x: 5, y: 5 }, size), true);
  assert.equal(overRulers({ x: 100, y: 100 }, size), false);
});

test("document units convert as physical lengths", () => {
  near(worldPerUnit({ unit: "px", dpi: 96 }), 1);
  near(worldPerUnit({ unit: "in", dpi: 96 }), 96);
  near(worldPerUnit({ unit: "mm", dpi: 96 }), 96 / 25.4);
  near(worldPerUnit({ unit: "pt", dpi: 72 }), 1);
});

// ---- store / commands -------------------------------------------------------

test("adding, moving and deleting a guide are undoable steps", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  const id = useEditor.getState().addGuide("x", 100);
  assert.deepEqual(useEditor.getState().doc.guides, [
    { id, axis: "x", position: 100 },
  ]);
  assert.equal(useEditor.getState().selectedGuideId, id);

  useEditor.getState().moveGuide(id, 250);
  assert.equal(useEditor.getState().doc.guides[0].position, 250);

  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.guides[0].position, 100);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.guides.length, 0);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.guides.length, 1);

  useEditor.getState().removeGuide(id);
  assert.equal(useEditor.getState().doc.guides.length, 0);
  assert.equal(useEditor.getState().selectedGuideId, null);
});

test("a guide drag commits as one undo step", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  const before = useEditor.getState().history.past.length;

  // What the ruler drag does: begin, create, drag, release.
  useEditor.getState().beginInteraction("Add guide");
  const id = useEditor.getState().addGuide("y", 10);
  useEditor.getState().moveGuide(id, 20);
  useEditor.getState().moveGuide(id, 30);
  useEditor.getState().endInteraction();

  assert.equal(useEditor.getState().history.past.length, before + 1);
  assert.deepEqual(useEditor.getState().doc.guides, [
    { id, axis: "y", position: 30 },
  ]);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.guides.length, 0);
});

test("Delete removes the selected guide before touching the selection", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.addFrame({ x: 0, y: 0 });
  const frameId = useEditor.getState().selection[0];
  const id = useEditor.getState().addGuide("x", 40);
  useEditor.getState().setSelection([frameId]);
  useEditor.getState().setSelectedGuide(id);

  const del = commands.find((command) => command.id === "edit.delete");
  del.run(useEditor.getState());
  assert.equal(useEditor.getState().doc.guides.length, 0);
  // The frame survived: the guide took the delete.
  assert.ok(useEditor.getState().doc.nodes[frameId]);
});

test("selecting a node drops the guide selection, so Delete hits the node", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.addFrame({ x: 0, y: 0 });
  const frameId = useEditor.getState().selection[0];
  const id = useEditor.getState().addGuide("x", 40);
  assert.equal(useEditor.getState().selectedGuideId, id);

  // Selecting through a non-canvas surface (Layers panel, a command) must not
  // leave a stale guide selection that swallows the next Delete.
  useEditor.getState().setSelection([frameId]);
  assert.equal(useEditor.getState().selectedGuideId, null);

  const del = commands.find((command) => command.id === "edit.delete");
  del.run(useEditor.getState());
  assert.equal(useEditor.getState().doc.nodes[frameId], undefined);
  assert.equal(useEditor.getState().doc.guides.length, 1);
});

test("cancelling a guide drag removes a guide the drag created", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  // What Esc / a second touch does mid-drag (see cancelActiveInteraction).
  useEditor.getState().beginInteraction("Add guide");
  const id = useEditor.getState().addGuide("x", 100);
  useEditor.getState().moveGuide(id, 140);
  useEditor.getState().cancelInteraction();
  assert.equal(useEditor.getState().doc.guides.length, 0);
  assert.equal(useEditor.getState().history.past.length, 0);
});

test("the ruler origin preference switches the origin and is resettable", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  editor.addFrame({ x: 300, y: 200 });
  const frameId = useEditor.getState().activeFrameId;
  assert.ok(frameId);

  const reset = commands.find((c) => c.id === "view.resetRulerOrigin");
  const toggle = commands.find((c) => c.id === "view.toggleRulerOrigin");
  assert.equal(usePreferences.getState().canvas.rulerOrigin, "artboard");
  assert.equal(reset.enabled(useEditor.getState()), true);

  // Document-origin mode: the reset command has nothing to do.
  toggle.run(useEditor.getState());
  assert.equal(usePreferences.getState().canvas.rulerOrigin, "world");
  assert.equal(reset.enabled(useEditor.getState()), false);
  // The active frame keeps tracking, so switching back needs no re-selection.
  assert.equal(useEditor.getState().activeFrameId, frameId);

  toggle.run(useEditor.getState());
  assert.equal(usePreferences.getState().canvas.rulerOrigin, "artboard");
  reset.run(useEditor.getState());
  assert.equal(useEditor.getState().activeFrameId, null);
  assert.deepEqual(rulerOrigin(useEditor.getState().doc, null), { x: 0, y: 0 });
  assert.equal(reset.enabled(useEditor.getState()), false);
});

test("locked guides are neither deletable nor clearable", () => {
  const editor = useEditor.getState();
  editor.newDocument();
  const id = useEditor.getState().addGuide("x", 40);
  useEditor.getState().setSelectedGuide(id);
  useEditor.getState().toggleGuidesLocked();

  const del = commands.find((command) => command.id === "guides.delete");
  const clear = commands.find((command) => command.id === "guides.clear");
  assert.equal(del.enabled(useEditor.getState()), false);
  assert.equal(clear.enabled(useEditor.getState()), false);
  // Locking also drops the selection, so Delete falls through to the scene.
  assert.equal(useEditor.getState().selectedGuideId, null);

  useEditor.getState().toggleGuidesLocked();
  assert.equal(clear.enabled(useEditor.getState()), true);
  clear.run(useEditor.getState());
  assert.equal(useEditor.getState().doc.guides.length, 0);
});
