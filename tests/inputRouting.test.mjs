import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let routeContact;
let judgeTap;
let exceedsTapTolerance;
let PEN_COOLDOWN_MS;
let TAP_MAX_MS;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({
    routeContact,
    judgeTap,
    exceedsTapTolerance,
    PEN_COOLDOWN_MS,
    TAP_MAX_MS,
  } = await server.ssrLoadModule("/src/canvas/inputRouting.ts"));
});

after(async () => server.close());

/** A first finger landing on the brush tool, with no pen anywhere in sight. */
function contact(overrides = {}) {
  return {
    pointerType: "touch",
    penDown: false,
    sincePen: Infinity,
    liveTouches: 0,
    tool: "brush",
    fingerDrawing: true,
    ...overrides,
  };
}

test("pen and mouse always reach the tool", () => {
  // Even mid-pinch and mid-cooldown: only touch is ever filtered.
  for (const pointerType of ["pen", "mouse"]) {
    assert.equal(routeContact(contact({ pointerType })), "tool");
    assert.equal(
      routeContact(contact({ pointerType, liveTouches: 2, sincePen: 0 })),
      "tool"
    );
  }
});

test("touch is rejected as palm while the pen is on the glass", () => {
  assert.equal(routeContact(contact({ penDown: true })), "reject-palm");
  // A palm outranks every other reading, including a second finger.
  assert.equal(
    routeContact(contact({ penDown: true, liveTouches: 1 })),
    "reject-palm"
  );
});

test("touch stays rejected for the cooldown after the pen lifts", () => {
  assert.equal(routeContact(contact({ sincePen: 0 })), "reject-cooldown");
  assert.equal(
    routeContact(contact({ sincePen: PEN_COOLDOWN_MS - 1 })),
    "reject-cooldown"
  );
  // Once it expires the finger is an ordinary contact again.
  assert.equal(routeContact(contact({ sincePen: PEN_COOLDOWN_MS })), "tool");
});

test("cooldown and palm rejection are distinct verdicts", () => {
  // The caller needs them apart: a cooldown contact can still complete an
  // undo tap, a palm cannot.
  assert.notEqual(
    routeContact(contact({ penDown: true, sincePen: 0 })),
    routeContact(contact({ penDown: false, sincePen: 0 }))
  );
});

test("a second finger promotes to a gesture, whatever the tool", () => {
  for (const tool of ["brush", "select", "pencil", "text"]) {
    assert.equal(routeContact(contact({ tool, liveTouches: 1 })), "gesture");
  }
  // Notably including on top of a finger-drawn stroke: that second contact is
  // how a touch-only user pinches out of the brush tool.
  assert.equal(
    routeContact(contact({ liveTouches: 1, fingerDrawing: true })),
    "gesture"
  );
  assert.equal(routeContact(contact({ liveTouches: 2 })), "gesture");
});

test("with finger drawing off, a lone finger pans on the drawing tools", () => {
  for (const tool of ["brush", "pencil", "eraser"]) {
    assert.equal(routeContact(contact({ tool, fingerDrawing: false })), "pan");
    assert.equal(routeContact(contact({ tool, fingerDrawing: true })), "tool");
  }
});

test("finger drawing does not gate the non-painting tools", () => {
  for (const tool of ["select", "node", "pen", "rect", "text", "bucket"]) {
    assert.equal(routeContact(contact({ tool, fingerDrawing: false })), "tool");
  }
});

test("a still two- or three-finger run is undo / redo", () => {
  const run = { maxPointers: 2, elapsedMs: 100, moved: false };
  assert.equal(judgeTap(run), "undo");
  assert.equal(judgeTap({ ...run, maxPointers: 3 }), "redo");
});

test("taps that travelled, lingered or used the wrong arity do nothing", () => {
  const run = { maxPointers: 2, elapsedMs: 100, moved: false };
  assert.equal(judgeTap({ ...run, moved: true }), null, "a pinch is not a tap");
  assert.equal(judgeTap({ ...run, elapsedMs: TAP_MAX_MS + 1 }), null);
  assert.equal(judgeTap({ ...run, maxPointers: 1 }), null, "one finger draws");
  assert.equal(judgeTap({ ...run, maxPointers: 4 }), null);
});

test("tap tolerance measures straight-line travel", () => {
  const origin = { x: 0, y: 0 };
  assert.equal(exceedsTapTolerance(origin, { x: 15, y: 0 }), false);
  assert.equal(exceedsTapTolerance(origin, { x: 12, y: 12 }), true);
  assert.equal(exceedsTapTolerance(origin, { x: 0, y: -20 }), true);
});
