import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let hexToHsv;
let hsvToHex;
let normalizeHex;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ hexToHsv, hsvToHex, normalizeHex } = await server.ssrLoadModule(
    "/src/model/color.ts"
  ));
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
