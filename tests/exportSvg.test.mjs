import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let createEmptyDocument;
let embeddedImageSize;
let exportSvg;
let pattern;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } =
    await server.ssrLoadModule("/src/model/types.ts"));
  ({ embeddedImageSize } =
    await server.ssrLoadModule("/src/io/imageDimensions.ts"));
  ({ pattern } = await server.ssrLoadModule("/src/model/paint.ts"));
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

test("SVG export embeds image patterns with their placement and alpha", () => {
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
  doc.rootIds = ["rect"];

  const svg = exportSvg(doc, { margin: 0 });
  assert.match(
    svg,
    /<pattern id="pat0" patternUnits="userSpaceOnUse" width="2" height="3" patternTransform="translate\(5 7\) rotate\(90\) scale\(2\)">/
  );
  assert.match(
    svg,
    new RegExp(`<image width="2" height="3" preserveAspectRatio="none" href="${data}"/>`)
  );
  assert.match(svg, /fill="url\(#pat0\)" fill-opacity="0.4"/);
  assert.doesNotMatch(svg, /#8a9099/);
});
