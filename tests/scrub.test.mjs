import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let scrubbedValue;
let isScrub;

const scrub = (overrides) =>
  scrubbedValue({
    scale: "linear",
    startValue: 0,
    dx: 0,
    step: 1,
    modifier: "none",
    ...overrides,
  });

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ scrubbedValue, isScrub } = await server.ssrLoadModule(
    "/src/ui/controls/scrub.ts"
  ));
});

after(async () => server.close());

test("a linear scrub adds one step per 4px, scaled by the modifier", () => {
  assert.equal(scrub({ startValue: 10, dx: 40 }), 20);
  assert.equal(scrub({ startValue: 10, dx: -40 }), 0);
  assert.equal(scrub({ startValue: 10, dx: 40, modifier: "coarse" }), 110);
  assert.equal(scrub({ startValue: 10, dx: 40, modifier: "fine" }), 11);
  // Sub-step travel rounds to the nearest notch rather than drifting.
  assert.equal(scrub({ startValue: 10, dx: 1 }), 10);
  assert.equal(scrub({ startValue: 10, dx: 3 }), 11);
});

test("a linear scrub commits clean values at fractional steps", () => {
  const v = scrub({ startValue: 0.3, dx: 4, step: 0.1 });
  assert.equal(v, 0.4);
  assert.equal(String(v), "0.4");
});

test("a log scrub changes the value by a constant ratio", () => {
  // 140px per doubling, both ways and from any starting point.
  assert.equal(scrub({ scale: "log", startValue: 100, dx: 140 }), 200);
  assert.equal(scrub({ scale: "log", startValue: 100, dx: -140 }), 50);
  assert.equal(scrub({ scale: "log", startValue: 800, dx: 140 }), 1600);
  assert.equal(scrub({ scale: "log", startValue: 800, dx: 280 }), 3200);
  // The same travel is a far bigger absolute jump when zoomed in, which is the
  // point: it is the same visual step.
  assert.equal(scrub({ scale: "log", startValue: 25, dx: 140 }), 50);
});

test("log modifiers stretch and compress the doubling distance", () => {
  assert.equal(scrub({ scale: "log", startValue: 100, dx: 140, modifier: "coarse" }), 1600);
  // Fine is a quarter of a doubling over the same travel: 2^(1/4).
  assert.equal(scrub({ scale: "log", startValue: 100, dx: 140, modifier: "fine" }), 119);
});

test("a log scrub is exact for any drag distance, not accumulated", () => {
  // Two frames of the same drag: the result depends only on total travel.
  const direct = scrub({ scale: "log", startValue: 100, dx: 210 });
  assert.equal(direct, Math.round(100 * Math.SQRT2 * 2));
  assert.equal(scrub({ scale: "log", startValue: 100, dx: 0 }), 100);
});

test("a log scrub falls back to linear when there is nothing to multiply", () => {
  assert.equal(scrub({ scale: "log", startValue: 0, dx: 40 }), 10);
  assert.equal(scrub({ scale: "log", startValue: -10, dx: 40 }), 0);
});

test("isScrub ignores jitter below the click threshold", () => {
  assert.equal(isScrub(2), false);
  assert.equal(isScrub(-2), false);
  assert.equal(isScrub(3), true);
  assert.equal(isScrub(-9), true);
});
