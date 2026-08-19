import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let sameValue;
let sharedValue;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ sameValue, sharedValue } = await server.ssrLoadModule(
    "/src/ui/panels/properties/sharedValue.ts"
  ));
});

after(async () => server.close());

const solid = (color, alpha = 1) => ({ type: "solid", color, alpha });

test("an empty selection reports the fallback, never mixed", () => {
  assert.deepEqual(sharedValue([], (s) => s.fill, solid("#000000")), {
    value: solid("#000000"),
    mixed: false,
  });
});

test("agreeing shapes report their shared value", () => {
  const shapes = [{ fill: solid("#ff0000") }, { fill: solid("#ff0000") }];
  const result = sharedValue(shapes, (s) => s.fill, null);
  assert.equal(result.mixed, false);
  assert.deepEqual(result.value, solid("#ff0000"));
});

test("disagreeing shapes report mixed, keeping the first value to edit from", () => {
  const shapes = [{ fill: solid("#ff0000") }, { fill: solid("#0000ff") }];
  const result = sharedValue(shapes, (s) => s.fill, null);
  assert.equal(result.mixed, true);
  assert.deepEqual(result.value, solid("#ff0000"));
});

test("null is a value like any other: shared none is not mixed", () => {
  const shapes = [{ stroke: null }, { stroke: null }];
  assert.equal(sharedValue(shapes, (s) => s.stroke, null).mixed, false);
  assert.equal(
    sharedValue([{ stroke: null }, { stroke: solid("#000000") }], (s) => s.stroke, null)
      .mixed,
    true
  );
});

test("paints compare by structure, not by identity", () => {
  assert.equal(sameValue(solid("#123456"), solid("#123456")), true);
  assert.equal(sameValue(solid("#123456"), solid("#123456", 0.5)), false);
  assert.equal(sameValue([4, 2], [4, 2]), true);
  assert.equal(sameValue([4, 2], [4, 2, 1]), false);
  assert.equal(sameValue([], []), true);
  // A missing key and an undefined one are different shapes of data.
  assert.equal(sameValue({ a: 1 }, { a: 1, b: undefined }), false);
});

test("a dash array differing only in a later element still reads as mixed", () => {
  const shapes = [{ dash: [8, 4] }, { dash: [8, 2] }];
  assert.equal(sharedValue(shapes, (s) => s.dash, []).mixed, true);
});
