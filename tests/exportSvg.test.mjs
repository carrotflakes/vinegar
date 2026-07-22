import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let embeddedImageSize;
let exportSvg;
let linearGradient;
let pattern;
let radialGradient;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } =
    await server.ssrLoadModule("/src/model/types.ts"));
  ({ embeddedImageSize } =
    await server.ssrLoadModule("/src/io/imageDimensions.ts"));
  ({ linearGradient, pattern, radialGradient } =
    await server.ssrLoadModule("/src/model/paint.ts"));
  ({ exportSvg } = await server.ssrLoadModule("/src/io/exportSvg.ts"));
});

after(async () => server.close());

function pngDataUrl(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function assetFromBytes(mimeType, bytes) {
  return {
    id: mimeType,
    kind: "image",
    mimeType,
    source: {
      type: "data",
      data: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
    },
  };
}

test("embedded image dimensions cover the supported raster and SVG formats", () => {
  const gif = new Uint8Array(10);
  gif.set(Buffer.from("GIF89a"));
  new DataView(gif.buffer).setUint16(6, 7, true);
  new DataView(gif.buffer).setUint16(8, 9, true);

  const bmp = new Uint8Array(26);
  bmp.set(Buffer.from("BM"));
  new DataView(bmp.buffer).setInt32(18, 11, true);
  new DataView(bmp.buffer).setInt32(22, -13, true);

  const webp = new Uint8Array(30);
  webp.set(Buffer.from("RIFF"));
  webp.set(Buffer.from("WEBP"), 8);
  webp.set(Buffer.from("VP8X"), 12);
  webp.set([16, 0, 0], 24);
  webp.set([18, 0, 0], 27);

  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08,
    0x08, 0x00, 0x17, 0x00, 0x15, 0x03,
  ]);
  const png = Buffer.from(pngDataUrl(2, 3).split(",")[1], "base64");

  assert.deepEqual(
    embeddedImageSize(assetFromBytes("image/png", png)),
    { width: 2, height: 3 }
  );
  assert.deepEqual(
    embeddedImageSize(assetFromBytes("image/gif", gif)),
    { width: 7, height: 9 }
  );
  assert.deepEqual(
    embeddedImageSize(assetFromBytes("image/bmp", bmp)),
    { width: 11, height: 13 }
  );
  assert.deepEqual(
    embeddedImageSize(assetFromBytes("image/webp", webp)),
    { width: 17, height: 19 }
  );
  assert.deepEqual(
    embeddedImageSize(assetFromBytes("image/jpeg", jpeg)),
    { width: 21, height: 23 }
  );
  assert.deepEqual(
    embeddedImageSize({
      id: "svg",
      kind: "image",
      mimeType: "image/svg+xml",
      source: {
        type: "data",
        data: `data:image/svg+xml,${encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" viewBox="0 0 80 20"/>'
        )}`,
      },
    }),
    { width: 40, height: 10 }
  );
});

test("SVG export embeds and reuses image patterns with placement and alpha", () => {
  const doc = createEmptyDocument();
  const data = pngDataUrl(2, 3);
  doc.assets.texture = {
    id: "texture",
    kind: "image",
    mimeType: "image/png",
    source: { type: "data", data },
  };
  doc.nodes.rect = {
    id: "rect",
    name: "Pattern",
    type: "rect",
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
    opacity: 1,
    fill: pattern("texture", {
      scale: 2,
      rotation: Math.PI / 2,
      offset: { x: 5, y: 7 },
      alpha: 0.4,
    }),
    stroke: null,
    strokeWidth: 0,
  };
  doc.nodes.rect2 = {
    ...doc.nodes.rect,
    id: "rect2",
    name: "Pattern copy",
    transform: [1, 0, 0, 1, 30, 0],
  };
  doc.rootIds = ["rect", "rect2"];

  const svg = exportSvg(doc, { margin: 0 });
  assert.ok(
    svg.includes(
      `<image id="img0" width="2" height="3" preserveAspectRatio="none" href="${data}"/>`
    )
  );
  assert.match(
    svg,
    /<pattern id="pat1" patternUnits="userSpaceOnUse" width="2" height="3" patternTransform="translate\(5 7\) rotate\(90\) scale\(2\)"><use href="#img0"\/><\/pattern>/
  );
  assert.equal(svg.split(data).length - 1, 1);
  assert.equal(svg.split("<pattern ").length - 1, 1);
  assert.equal(svg.split('fill="url(#pat1)" fill-opacity="0.4"').length - 1, 2);
  assert.doesNotMatch(svg, /#8a9099/);
});

test("SVG gradients use local coordinates without distorting their geometry", () => {
  const doc = createEmptyDocument();
  const stops = [
    { offset: 0, color: "#ff0000", alpha: 1 },
    { offset: 1, color: "#0000ff", alpha: 1 },
  ];
  doc.nodes.rect = {
    id: "rect",
    name: "Gradients",
    type: "rect",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
    opacity: 1,
    fill: linearGradient(stops, Math.PI / 4),
    stroke: radialGradient(stops),
    strokeWidth: 2,
  };
  doc.rootIds = ["rect"];

  const svg = exportSvg(doc, { margin: 0 });
  assert.match(
    svg,
    /<linearGradient id="grad0" gradientUnits="userSpaceOnUse" x1="25" y1="-25" x2="175" y2="125">/
  );
  assert.match(
    svg,
    /<radialGradient id="grad1" gradientUnits="userSpaceOnUse" cx="100" cy="50" r="111.803">/
  );
});

test("SVG paths export their data-driven fill rule", () => {
  const doc = createEmptyDocument();
  const anchor = (x, y) => ({ p: { x, y }, hIn: null, hOut: null });
  doc.nodes.path = {
    id: "path",
    name: "Even-odd path",
    type: "path",
    fillRule: "evenodd",
    subpaths: [
      {
        anchors: [anchor(0, 0), anchor(100, 0), anchor(100, 100), anchor(0, 100)],
        closed: true,
      },
      {
        anchors: [anchor(25, 25), anchor(75, 25), anchor(75, 75), anchor(25, 75)],
        closed: true,
      },
    ],
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
    opacity: 1,
    fill: { type: "solid", color: "#ff0000", alpha: 1 },
    stroke: null,
    strokeWidth: 0,
  };
  doc.rootIds = ["path"];

  const svg = exportSvg(doc, { margin: 0 });
  assert.match(svg, /<path d="[^"]+" fill-rule="evenodd"/);
});

test("SVG color-adjust exports a chained feColorMatrix filter in sRGB", () => {
  const doc = createEmptyDocument();
  doc.nodes.rect = {
    id: "rect",
    name: "Adjusted",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
    opacity: 1,
    fill: { type: "solid", color: "#ff0000", alpha: 1 },
    stroke: null,
    strokeWidth: 0,
    effects: [
      { type: "color-adjust", brightness: 1.2, contrast: 1.1, saturation: 0.5, hue: 30 },
    ],
  };
  doc.rootIds = ["rect"];

  const svg = exportSvg(doc, { margin: 0 });
  // Brightness/contrast matrices, then saturate, then hueRotate — the same
  // order the canvas preview applies, all in sRGB to match CSS filters.
  assert.match(svg, /<filter id="fx0"[^>]*>[\s\S]*<\/filter>/);
  assert.match(svg, /type="matrix" values="1.2 0 0 0 0/);
  assert.match(svg, /type="saturate" values="0.5"/);
  assert.match(svg, /type="hueRotate" values="30"/);
  assert.match(svg, /color-interpolation-filters="sRGB"/);
  // The rect references the generated filter.
  assert.match(svg, /filter="url\(#fx0\)"/);
});
