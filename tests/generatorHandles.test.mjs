import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let handles;
let GENERATORS;
let defaultArgs;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  handles = await server.ssrLoadModule("/src/model/generators/handles.ts");
  ({ GENERATORS, defaultArgs } = await server.ssrLoadModule(
    "/src/model/generators/generators.ts"
  ));
});

after(async () => server.close());

const paramOf = (id, key) =>
  GENERATORS[id].params.find((p) => p.key === key);

/** Drag a handle from its own position by a local-space delta. */
const drag = (handle, args, delta) =>
  handles.handleParamValue(
    handle,
    args[handle.param],
    args[handle.param],
    handle.at,
    { x: handle.at.x + delta.x, y: handle.at.y + delta.y }
  );

test("every built-in handle drives one of its generator's params", () => {
  for (const [id, def] of Object.entries(GENERATORS)) {
    const args = defaultArgs(def);
    const keys = new Set(def.params.map((p) => p.key));
    for (const handle of handles.generatorHandles(id, args)) {
      assert.ok(keys.has(handle.param), `${id}: unknown param ${handle.param}`);
      assert.ok(Number.isFinite(handle.at.x) && Number.isFinite(handle.at.y));
    }
  }
});

test("a handle sits at the geometry the current args produce", () => {
  const args = defaultArgs(GENERATORS.star);
  const [radius] = handles.generatorHandles("star", args);
  assert.equal(radius.param, "radius");
  assert.ok(
    Math.abs(Math.hypot(radius.at.x, radius.at.y) - args.radius) < 1e-9,
    "the radius knob rides the outer vertex circle"
  );
});

test("dragging outwards along the axis raises the value by the travel", () => {
  const args = defaultArgs(GENERATORS.star);
  const [radius, innerRatio] = handles.generatorHandles("star", args);
  const out = { x: radius.axis.x * 20, y: radius.axis.y * 20 };
  assert.ok(Math.abs(drag(radius, args, out) - (args.radius + 20)) < 1e-9);
  // The ratio knob is scaled by the radius: 20 local units is 20/80 of it.
  const inward = { x: innerRatio.axis.x * 20, y: innerRatio.axis.y * 20 };
  assert.ok(
    Math.abs(drag(innerRatio, args, inward) - (args.innerRatio + 20 / 80)) < 1e-9
  );
});

test("an inverted mapping falls as the knob is pulled out", () => {
  const args = defaultArgs(GENERATORS.gear);
  const depth = handles
    .generatorHandles("gear", args)
    .find((h) => h.param === "toothDepth");
  const out = { x: depth.axis.x * 8, y: depth.axis.y * 8 };
  assert.ok(drag(depth, args, out) < args.toothDepth);
});

test("phase tracks the terminator in both halves of the moon cycle", () => {
  for (const phase of [0.25, 0.75]) {
    const args = { ...defaultArgs(GENERATORS.moon), phase };
    const knob = handles
      .generatorHandles("moon", args)
      .find((h) => h.param === "phase");
    const moved = drag(knob, args, { x: -args.radius * 0.4, y: 0 });
    // -0.4R along +x with -1/(4R) per unit is +0.1 of phase.
    assert.ok(Math.abs(moved - (phase + 0.1)) < 1e-9, `phase ${phase}`);
  }
});

test("an angle handle turns with the pointer about its centre", () => {
  const args = defaultArgs(GENERATORS.sector);
  const sweep = handles
    .generatorHandles("sector", args)
    .find((h) => h.param === "sweepAngle");
  assert.equal(sweep.kind, "angle");
  const r = Math.hypot(sweep.at.x, sweep.at.y);
  const start = Math.atan2(sweep.at.y, sweep.at.x);
  const turned = (start + Math.PI / 6) % (Math.PI * 2);
  const value = handles.handleParamValue(
    sweep,
    args.sweepAngle,
    args.sweepAngle,
    sweep.at,
    { x: Math.cos(turned) * r, y: Math.sin(turned) * r }
  );
  assert.ok(Math.abs(value - (args.sweepAngle + 30)) < 1e-9);
});

test("an angle drag past ±180° keeps winding in the same direction", () => {
  const handle = { param: "a", kind: "angle", at: { x: 10, y: 0 }, center: { x: 0, y: 0 } };
  // Pointer now 190° round from the grab: the raw reading wraps to -170°, but
  // tracking a live value of 170 must resolve it as 190.
  const local = { x: Math.cos((190 * Math.PI) / 180) * 10, y: Math.sin((190 * Math.PI) / 180) * 10 };
  assert.ok(
    Math.abs(handles.handleParamValue(handle, 0, 170, handle.at, local) - 190) < 1e-9
  );
});

test("values are clamped and integer params are rounded", () => {
  const points = paramOf("star", "points");
  assert.equal(handles.clampParamValue(points, 6.4), 6);
  assert.equal(handles.clampParamValue(points, 1000), points.max);
  assert.equal(handles.clampParamValue(points, -5), points.min);
  const ratio = paramOf("star", "innerRatio");
  assert.equal(handles.clampParamValue(ratio, 2), ratio.max);
  assert.equal(handles.clampParamValue(ratio, 0.42), 0.42);
});

test("generators without handle definitions yield none", () => {
  assert.deepEqual(handles.generatorHandles("script_x", { a: 1 }), []);
});
