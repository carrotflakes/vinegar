import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let hexToHsv;
let hsvToHex;
let normalizeHex;
let linearToSrgb;
let linearToSrgb255;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ hexToHsv, hsvToHex, normalizeHex, linearToSrgb, linearToSrgb255 } =
    await server.ssrLoadModule("/src/model/color.ts"));
});

after(async () => {
  await server.close();
});

test("hex and HSV round-trip", () => {
  for (const hex of ["#000000", "#ffffff", "#ff0000", "#3a7bd5", "#7f7f7f", "#00ff88"]) {
    assert.equal(hsvToHex(hexToHsv(hex)), hex);
  }
});

test("hue, saturation and value read off primaries", () => {
  assert.deepEqual(hexToHsv("#ff0000"), { h: 0, s: 1, v: 1 });
  assert.deepEqual(hexToHsv("#00ff00"), { h: 120, s: 1, v: 1 });
  assert.deepEqual(hexToHsv("#0000ff"), { h: 240, s: 1, v: 1 });
  // Grays have no hue and no saturation.
  assert.deepEqual(hexToHsv("#808080"), { h: 0, s: 0, v: 128 / 255 });
});

test("hsvToHex clamps and wraps out-of-range input", () => {
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), "#ff0000");
  assert.equal(hsvToHex({ h: -120, s: 1, v: 1 }), "#0000ff");
  assert.equal(hsvToHex({ h: 0, s: 2, v: 2 }), "#ff0000");
  assert.equal(hsvToHex({ h: 0, s: -1, v: -1 }), "#000000");
});

test("normalizeHex accepts shorthand and rejects junk", () => {
  assert.equal(normalizeHex("f0a"), "#ff00aa");
  assert.equal(normalizeHex("  #ABCDEF "), "#abcdef");
  assert.equal(normalizeHex("#abcd"), null);
  assert.equal(normalizeHex("rebeccapurple"), null);
});

test("the tabled sRGB encode matches the exact curve to within an output level", () => {
  // `linearToSrgb255` trades a per-pixel Math.pow for a lookup; the whole
  // point is that the result is indistinguishable in 8 bits.
  let worst = 0;
  for (let i = 0; i <= 20000; i++) {
    const v = i / 20000;
    worst = Math.max(worst, Math.abs(linearToSrgb255(v) - linearToSrgb(v) * 255));
  }
  assert.ok(worst < 0.5, `worst error ${worst} of an output level`);
  // Out-of-gamut input (an Oklab colour can produce it) clamps rather than
  // running off the table.
  assert.equal(linearToSrgb255(-0.2), 0);
  assert.equal(linearToSrgb255(1.4), 255);
  assert.equal(linearToSrgb255(NaN), 0);
});
