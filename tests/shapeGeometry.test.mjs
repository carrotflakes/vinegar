// The agreement this project's rendering correctness rests on: bounds,
// hit-testing and SVG export must all describe the *same* outline.
//
// `model/path/shapeGeometry.ts` is the single derivation, but several readers
// keep a fast path of their own — an analytic ellipse in the hit test, an
// `<ellipse>` element in the export, `ctx.rect()` on the canvas. Those are the
// places where the outlines can silently drift apart, so this file pins each
// fast path to the canonical geometry rather than to a hard-coded expectation.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let shapeSubpaths;
let shapePolylines;
let shapeBounds;
let hitTestShape;
let convertShapeToPath;
let exportSvg;
let createEmptyDocument;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ shapeSubpaths, shapePolylines } = await server.ssrLoadModule(
    "/src/model/path/shapeGeometry.ts"
  ));
  ({ shapeBounds } = await server.ssrLoadModule("/src/model/geometry/bounds.ts"));
  ({ hitTestShape } = await server.ssrLoadModule("/src/model/geometry/hitTest.ts"));
  ({ convertShapeToPath } = await server.ssrLoadModule(
    "/src/model/path/convertToPath.ts"
  ));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
  ({ createEmptyDocument } = await server.ssrLoadModule("/src/model/types.ts"));
});

after(async () => server.close());

const shape = (id, type, patch) => ({
  id,
  name: type,
  type,
  ...SHAPE_BASE,
  ...NODE_BASE,
  fill: { type: "solid", color: "#000000", alpha: 1 },
  strokeWidth: 0,
  transform: [1, 0, 0, 1, 0, 0],
  modifiers: [],
  ...patch,
});

const anchors = (points, closed) => ({
  anchors: points.map((p) => ({ p, hIn: null, hOut: null })),
  closed,
});

const FIXTURES = {
  rect: shape("s", "rect", { x: 10, y: 5, width: 40, height: 24, cornerRadius: 0 }),
  "rounded rect": shape("s", "rect", {
    x: 10, y: 5, width: 40, height: 24, cornerRadius: 8,
  }),
  ellipse: shape("s", "ellipse", { x: 10, y: 5, width: 40, height: 24 }),
  line: shape("s", "line", { x1: 10, y1: 5, x2: 50, y2: 29, strokeWidth: 3,
    stroke: { type: "solid", color: "#000000", alpha: 1 } }),
  "closed path": shape("s", "path", {
    fillRule: "nonzero",
    subpaths: [{
      closed: true,
      anchors: [
        { p: { x: 10, y: 5 }, hIn: null, hOut: { x: 30, y: -5 } },
        { p: { x: 50, y: 20 }, hIn: { x: 55, y: 0 }, hOut: null },
        { p: { x: 20, y: 30 }, hIn: null, hOut: null },
      ],
    }],
  }),
  "open path": shape("s", "path", {
    fillRule: "nonzero",
    subpaths: [anchors([{ x: 10, y: 5 }, { x: 40, y: 20 }, { x: 20, y: 30 }], false)],
  }),
  brush: shape("s", "brush", {
    fill: { type: "solid", color: "#000000", alpha: 1 },
    anchors: [
      { p: { x: 10, y: 10 }, w: 6, hIn: null, hOut: null },
      { p: { x: 30, y: 14 }, w: 10, hIn: null, hOut: null },
      { p: { x: 50, y: 10 }, w: 4, hIn: null, hOut: null },
    ],
  }),
};

/** A compound path needs its components in the document to resolve at all. */
function compoundDoc() {
  const outer = shape("outer", "rect", {
    x: 0, y: 0, width: 40, height: 40, cornerRadius: 0, fill: null,
  });
  const inner = shape("inner", "ellipse", {
    x: 10, y: 10, width: 20, height: 20, fill: null,
    // A rotated component: its own transform has to be baked into the
    // compound's geometry, and bounds must measure that geometry rather than
    // the box of a box.
    transform: [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 12, -8],
  });
  const compound = shape("s", "compoundPath", { childIds: ["outer", "inner"] });
  const empty = createEmptyDocument();
  return {
    ...empty,
    rootIds: ["s"],
    nodes: { s: compound, outer, inner },
  };
}

const docOf = (node) => {
  const empty = createEmptyDocument();
  return { ...empty, rootIds: [node.id], nodes: { [node.id]: node } };
};

function allFixtures() {
  const entries = Object.entries(FIXTURES).map(([name, node]) => [
    name,
    node,
    docOf(node),
  ]);
  const doc = compoundDoc();
  entries.push(["compound path", doc.nodes.s, doc]);
  return entries;
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from a point to a shape's canonical outline. */
function distToOutline(node, doc) {
  return (p) => {
    let best = Infinity;
    for (const line of shapePolylines(node, doc)) {
      const pts = line.points;
      const last = line.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < last; i++) {
        best = Math.min(best, distToSegment(p, pts[i], pts[(i + 1) % pts.length]));
      }
    }
    return best;
  };
}

function boundsOf(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// ---------------------------------------------------------------------------

test("bounds measure the canonical geometry", () => {
  for (const [name, node, doc] of allFixtures()) {
    const points = shapePolylines(node, doc).flatMap((line) => line.points);
    assert.ok(points.length, `${name}: no canonical geometry`);
    const measured = shapeBounds(node, doc);
    const expected = boundsOf(points);
    for (const key of ["x", "y", "width", "height"]) {
      assert.ok(
        Math.abs(measured[key] - expected[key]) < 0.05,
        `${name}: bounds.${key} is ${measured[key]}, geometry says ${expected[key]}`
      );
    }
  }
});

test("hit testing agrees with the canonical geometry away from the outline", () => {
  // Flattening error lives in a thin band around the outline; outside that
  // band an analytic fast path and the generic route must give one answer.
  const BAND = 0.5;
  for (const [name, node, doc] of allFixtures()) {
    const asPath = convertShapeToPath(node, doc);
    const pathDoc = docOf(asPath);
    const distance = distToOutline(node, doc);
    const b = shapeBounds(node, doc);
    let checked = 0;
    for (let i = 0; i <= 24; i++) {
      for (let j = 0; j <= 24; j++) {
        const p = {
          x: b.x - 4 + ((b.width + 8) * i) / 24,
          y: b.y - 4 + ((b.height + 8) * j) / 24,
        };
        if (distance(p) < BAND) continue;
        checked++;
        assert.equal(
          hitTestShape(doc, node, p, 0),
          hitTestShape(pathDoc, asPath, p, 0),
          `${name}: hit test disagrees with its own geometry at ${p.x},${p.y}`
        );
      }
    }
    assert.ok(checked > 50, `${name}: only ${checked} points were comparable`);
  }
});

test("SVG primitive elements carry the geometry's own extents", () => {
  // rect/ellipse/line export as SVG primitives rather than path data. That is
  // an output-form shortcut, so the numbers must still be the geometry's.
  const attrs = (markup, tag) => {
    const element = markup.match(new RegExp(`<${tag}\\s[^>]*>`));
    assert.ok(element, `no <${tag}> in the export`);
    return Object.fromEntries(
      [...element[0].matchAll(/([a-z][a-z0-9-]*)="([-\d.]+)"/g)].map(
        ([, k, v]) => [k, Number(v)]
      )
    );
  };

  const rect = FIXTURES.rect;
  const r = attrs(exportSvg(docOf(rect)), "rect");
  const rb = shapeBounds(rect);
  assert.deepEqual(
    { x: r.x, y: r.y, width: r.width, height: r.height },
    { x: rb.x, y: rb.y, width: rb.width, height: rb.height }
  );

  const rounded = attrs(exportSvg(docOf(FIXTURES["rounded rect"])), "rect");
  assert.equal(rounded.rx, 8);
  assert.equal(rounded.ry, 8);

  const ellipse = FIXTURES.ellipse;
  const e = attrs(exportSvg(docOf(ellipse)), "ellipse");
  const eb = shapeBounds(ellipse);
  assert.deepEqual(
    { cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry },
    {
      cx: eb.x + eb.width / 2,
      cy: eb.y + eb.height / 2,
      rx: eb.width / 2,
      ry: eb.height / 2,
    }
  );

  const line = FIXTURES.line;
  const l = attrs(exportSvg(docOf(line)), "line");
  assert.deepEqual(
    { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 },
    { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 }
  );
});

test("exported path data walks the canonical anchors", () => {
  for (const [name, node, doc] of allFixtures()) {
    if (node.type === "rect" || node.type === "ellipse" || node.type === "line") {
      continue; // exported as primitives, checked above
    }
    const markup = exportSvg(doc);
    const data = markup.match(/ d="([^"]*)"/);
    assert.ok(data, `${name}: no path data in the export`);
    const numbers = data[1].match(/-?[\d.]+/g).map(Number);
    const exported = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      exported.push({ x: numbers[i], y: numbers[i + 1] });
    }
    // Control points are free to sit anywhere, but every on-curve point of the
    // canonical geometry has to be in there: that is the outline itself.
    for (const subpath of shapeSubpaths(node, doc)) {
      for (const anchor of subpath.anchors) {
        assert.ok(
          exported.some(
            (p) =>
              Math.abs(p.x - anchor.p.x) < 0.01 &&
              Math.abs(p.y - anchor.p.y) < 0.01
          ),
          `${name}: anchor ${anchor.p.x},${anchor.p.y} is missing from the export`
        );
      }
    }
  }
});

test("a shape's outline, its bounds and its fill rule survive Convert to Path", () => {
  for (const [name, node, doc] of allFixtures()) {
    if (node.type === "text" || node.type === "image") continue;
    const asPath = convertShapeToPath(node, doc);
    const before = shapeSubpaths(node, doc);
    const after = shapeSubpaths(asPath, docOf(asPath));
    assert.equal(
      after.length,
      before.length,
      `${name}: converting changed the contour count`
    );
    const b = shapeBounds(node, doc);
    const a = shapeBounds(asPath, docOf(asPath));
    for (const key of ["x", "y", "width", "height"]) {
      assert.ok(
        Math.abs(a[key] - b[key]) < 0.05,
        `${name}: converting moved bounds.${key} (${b[key]} → ${a[key]})`
      );
    }
  }
});
