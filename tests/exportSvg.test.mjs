import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { NODE_BASE, SHAPE_BASE } from "./nodeBase.mjs";

let server;
let createEmptyDocument;
let embeddedImageSize;
let exportSvg;
let pattern;
let gradient;
let gradientStop;
let freeform;
let freeformPoint;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ createEmptyDocument } =
    await server.ssrLoadModule("/src/model/types.ts"));
  ({ embeddedImageSize } =
    await server.ssrLoadModule("/src/io/imageDimensions.ts"));
  ({ pattern } =
    await server.ssrLoadModule("/src/model/paint.ts"));
  ({ gradient, gradientStop } =
    await server.ssrLoadModule("/src/model/gradient.ts"));
  ({ freeform, freeformPoint } =
    await server.ssrLoadModule("/src/model/freeform.ts"));
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
    ...SHAPE_BASE, cornerRadius: 0,
    ...NODE_BASE,
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

test("SVG gradients export their placement as a unit-space gradientTransform", () => {
  const doc = createEmptyDocument();
  const stops = [gradientStop("#ff0000", 0), gradientStop("#0000ff", 1)];
  doc.nodes.rect = {
    id: "rect",
    name: "Gradients",
    type: "rect",
    ...SHAPE_BASE, cornerRadius: 0,
    ...NODE_BASE,
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
    opacity: 1,
    // Bounds space: the unit square maps onto the 200×100 box, so the ramp
    // runs (0,50) → (200,50) and its perpendicular axis is the box height.
    fill: gradient(stops),
    stroke: gradient(stops, { kind: "radial", spread: "reflect" }),
    strokeWidth: 2,
  };
  doc.rootIds = ["rect"];

  const svg = exportSvg(doc, { margin: 0 });
  assert.match(
    svg,
    /<linearGradient id="grad0" gradientUnits="userSpaceOnUse" gradientTransform="matrix\(200,0,0,100,0,50\)" x1="0" y1="0" x2="1" y2="0">/
  );
  assert.match(
    svg,
    /<radialGradient id="grad1" gradientUnits="userSpaceOnUse" gradientTransform="matrix\(100,0,0,50,100,50\)" spreadMethod="reflect" cx="0" cy="0" r="1">/
  );
});

test("SVG freeform rasters cover the full stroke instead of repeating", () => {
  const doc = createEmptyDocument();
  doc.nodes.line = {
    id: "line",
    name: "Freeform line",
    type: "line",
    ...SHAPE_BASE,
    ...NODE_BASE,
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 0,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
    opacity: 1,
    fill: null,
    stroke: freeform([
      freeformPoint("#ff0000", { x: 0, y: 0 }),
      freeformPoint("#0000ff", { x: 1, y: 1 }),
    ]),
    strokeWidth: 20,
  };
  doc.rootIds = ["line"];

  const previousDocument = globalThis.document;
  const PreviousImageData = globalThis.ImageData;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ putImageData: () => {} }),
      toDataURL: () => "data:image/png;base64,AA==",
    }),
  };
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
  try {
    const svg = exportSvg(doc, { margin: 0 });
    assert.match(
      svg,
      /<pattern id="ff0" patternUnits="userSpaceOnUse" x="-11" y="-11" width="122" height="22">/
    );
  } finally {
    globalThis.document = previousDocument;
    globalThis.ImageData = PreviousImageData;
  }
});

test("a conic gradient falls back to a wedge pattern SVG has a def for", () => {
  const doc = createEmptyDocument();
  doc.nodes.rect = {
    id: "rect",
    name: "Conic",
    type: "rect",
    ...SHAPE_BASE, cornerRadius: 0,
    ...NODE_BASE,
    x: 0, y: 0, width: 100, height: 100,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
    opacity: 1,
    fill: gradient([gradientStop("#ff0000", 0), gradientStop("#00ff00", 1)], {
      kind: "conic",
    }),
    stroke: null,
    strokeWidth: 0,
  };
  doc.rootIds = ["rect"];

  const svg = exportSvg(doc, { margin: 0 });
  assert.match(svg, /<pattern id="grad0" patternUnits="userSpaceOnUse"/);
  assert.match(svg, /fill="url\(#grad0\)"/);
});

test("SVG paths export their data-driven fill rule", () => {
  const doc = createEmptyDocument();
  const anchor = (x, y) => ({ p: { x, y }, hIn: null, hOut: null });
  doc.nodes.path = {
    id: "path",
    name: "Even-odd path",
    type: "path",
    ...SHAPE_BASE, fillRule: "nonzero",
    ...NODE_BASE,
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
    ...SHAPE_BASE, cornerRadius: 0,
    ...NODE_BASE,
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
      { id: "fx_adjust", enabled: true, type: "color-adjust", brightness: 1.2, contrast: 1.1, saturation: 0.5, hue: 30 },
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

test("SVG tint exports a mix feColorMatrix preserving alpha", () => {
  const doc = createEmptyDocument();
  doc.nodes.rect = {
    id: "rect",
    name: "Tinted",
    type: "rect",
    ...SHAPE_BASE, cornerRadius: 0,
    ...NODE_BASE,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    transform: [1, 0, 0, 1, 0, 0],
    transformOrigin: null,
    opacity: 1,
    fill: { type: "solid", color: "#ffffff", alpha: 1 },
    stroke: null,
    strokeWidth: 0,
    effects: [
      { id: "fx_tint", enabled: true, type: "tint", color: "#0000ff", alpha: 0.5 },
    ],
  };
  doc.rootIds = ["rect"];

  const svg = exportSvg(doc, { margin: 0 });
  // mix(src, #0000ff, 0.5): diagonal 0.5, blue channel offset 0.5, alpha kept.
  assert.match(
    svg,
    /type="matrix" values="0.5 0 0 0 0 0 0.5 0 0 0 0 0 0.5 0 0.5 0 0 0 1 0"/
  );
  assert.match(svg, /color-interpolation-filters="sRGB"/);
  assert.match(svg, /filter="url\(#fx0\)"/);
});

function effectRect(effects) {
  const doc = createEmptyDocument();
  doc.nodes.rect = {
    id: "rect",
    name: "Decorated",
    type: "rect",
    ...SHAPE_BASE, cornerRadius: 0,
    ...NODE_BASE,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { type: "solid", color: "#ff0000", alpha: 1 },
    effects,
  };
  doc.rootIds = ["rect"];
  return doc;
}

const GREEN_FILL = {
  id: "fx_fill",
  enabled: true,
  type: "fill",
  paint: { type: "solid", color: "#00ff00", alpha: 1 },
  blendMode: "normal",
};

test("SVG fill and stroke effects paint extra elements from the same geometry", () => {
  const svg = exportSvg(
    effectRect([
      GREEN_FILL,
      {
        id: "fx_stroke",
        enabled: true,
        type: "stroke",
        paint: { type: "solid", color: "#0000ff", alpha: 1 },
        width: 4,
        alignment: "outside",
        cap: "round",
        join: "miter",
        blendMode: "normal",
      },
    ]),
    { margin: 0 }
  );
  // No pixel effects, so the stack produces no <filter> at all.
  assert.doesNotMatch(svg, /<filter/);
  // The shape's own artwork, then the fill effect over it.
  assert.match(svg, /fill="#ff0000"[\s\S]*fill="#00ff00" stroke="none"/);
  // Outside alignment: double width, masked back to outside the silhouette.
  assert.match(svg, /<g mask="url\(#strokeMask\d+\)">/);
  assert.match(svg, /stroke="#0000ff" stroke-width="8"/);
});

test("a stroke effect honours center alignment without a mask", () => {
  const svg = exportSvg(
    effectRect([
      {
        id: "fx_stroke",
        enabled: true,
        type: "stroke",
        paint: { type: "solid", color: "#0000ff", alpha: 1 },
        width: 4,
        alignment: "center",
        cap: "butt",
        join: "bevel",
        blendMode: "normal",
      },
    ]),
    { margin: 0 }
  );
  assert.match(
    svg,
    /stroke="#0000ff" stroke-width="4" stroke-linecap="butt" stroke-linejoin="bevel"/
  );
  assert.doesNotMatch(svg, /mask=/);
});

test("a geometry effect splits the filter chain at its own position", () => {
  // blur, then fill: the fill is a sibling of the filtered artwork.
  const after = exportSvg(
    effectRect([{ id: "fx_blur", enabled: true, type: "blur", radius: 2 }, GREEN_FILL]),
    { margin: 0 }
  );
  assert.match(
    after,
    /<g filter="url\(#fx0\)"><rect [^>]*\/><\/g><rect [^>]*fill="#00ff00"/
  );

  // fill, then blur: the filter wraps both, so the added fill is blurred too.
  const before = exportSvg(
    effectRect([GREEN_FILL, { id: "fx_blur", enabled: true, type: "blur", radius: 2 }]),
    { margin: 0 }
  );
  assert.match(
    before,
    /<g filter="url\(#fx0\)"><rect [^>]*\/><rect [^>]*fill="#00ff00"[^>]*\/><\/g>/
  );
});

test("fill and stroke effects are inert on a node with no outline", () => {
  const doc = effectRect([]);
  doc.nodes.group = {
    id: "group",
    name: "Group",
    type: "group",
    clipsToMask: false,
    ...NODE_BASE,
    childIds: ["rect"],
    transform: [1, 0, 0, 1, 0, 0],
    effects: [GREEN_FILL],
  };
  doc.rootIds = ["group"];

  const svg = exportSvg(doc, { margin: 0 });
  assert.doesNotMatch(svg, /#00ff00/);
  // A geometry-only stack must not leave an empty filter behind: SVG renders a
  // childless <filter> as transparent black, which would erase the group.
  assert.doesNotMatch(svg, /<filter/);
  assert.doesNotMatch(svg, /filter="url/);
  assert.match(svg, /fill="#ff0000"/);
});

test("a blending geometry effect exports mix-blend-mode inside an isolated group", () => {
  const svg = exportSvg(
    effectRect([
      { ...GREEN_FILL, blendMode: "multiply" },
      {
        id: "fx_stroke",
        enabled: true,
        type: "stroke",
        paint: { type: "solid", color: "#0000ff", alpha: 1 },
        width: 4,
        alignment: "inside",
        cap: "round",
        join: "round",
        blendMode: "screen",
      },
    ]),
    { margin: 0 }
  );
  assert.match(svg, /fill="#00ff00" stroke="none" style="mix-blend-mode:multiply"/);
  // Off-centre alignment blends the clipped group as a whole.
  assert.match(
    svg,
    /<g clip-path="url\(#strokeClip\d+\)" style="mix-blend-mode:screen">/
  );
  // Without isolation the blend would reach the artwork behind the node.
  assert.match(svg, /<g style="isolation:isolate">/);
});

test("a node blend mode survives the isolation added for geometry effects", () => {
  const doc = effectRect([GREEN_FILL]);
  doc.nodes.rect.blendMode = "overlay";
  const svg = exportSvg(doc, { margin: 0 });
  assert.match(svg, /<g style="mix-blend-mode:overlay;isolation:isolate">/);
  // A normal-blend effect stays attribute-free.
  assert.doesNotMatch(svg, /fill="#00ff00"[^>]*mix-blend-mode/);
});

/** A frame holding one red rect, plus whatever frame fields the test needs. */
function framedRect(frameFields = {}) {
  const doc = createEmptyDocument();
  doc.nodes.rect = {
    id: "rect",
    name: "Inside",
    type: "rect",
    ...SHAPE_BASE, cornerRadius: 0,
    ...NODE_BASE,
    x: 10,
    y: 10,
    width: 50,
    height: 40,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { type: "solid", color: "#ff0000", alpha: 1 },
  };
  doc.nodes.frame = {
    id: "frame",
    name: "Frame",
    type: "frame",
    ...NODE_BASE,
    childIds: ["rect"],
    width: 200,
    height: 150,
    background: null,
    clipsContent: false,
    transform: [1, 0, 0, 1, 0, 0],
    ...frameFields,
  };
  doc.rootIds = ["frame"];
  return doc;
}

test("a frame exports its children", () => {
  const svg = exportSvg(framedRect(), { margin: 0 });
  assert.match(svg, /fill="#ff0000"/);
});

test("a frame background paints behind its children", () => {
  const svg = exportSvg(framedRect({ background: "#0000ff" }), { margin: 0 });
  const bg = svg.indexOf('fill="#0000ff"');
  const child = svg.indexOf('fill="#ff0000"');
  assert.ok(bg >= 0, "the frame background is missing");
  assert.ok(bg < child, "the background must precede the content it sits behind");
  // A transparent frame stays transparent — the editor's checkerboard is chrome.
  assert.doesNotMatch(exportSvg(framedRect(), { margin: 0 }), /<rect width="200"/);
});

test("a frame clips its content only when it is set to", () => {
  assert.match(
    exportSvg(framedRect({ clipsContent: true }), { margin: 0 }),
    /<g clip-path="url\(#clip\d+\)">/
  );
  assert.doesNotMatch(exportSvg(framedRect(), { margin: 0 }), /clip-path/);
});

test("a blend inside a frame still isolates the drawing from the page", () => {
  const doc = framedRect();
  doc.nodes.rect.blendMode = "multiply";
  assert.match(exportSvg(doc, { margin: 0 }), /<svg[^>]*style="isolation:isolate"/);
});

test("a clipping frame crops the export range to its content box", () => {
  // The rect runs past the frame's right edge. What the frame crops away is
  // never painted, so it must not stretch the exported viewBox either.
  const overflowing = (frameFields) => {
    const doc = framedRect(frameFields);
    Object.assign(doc.nodes.rect, { x: 150, y: 10, width: 200, height: 40 });
    return doc;
  };
  const open = exportSvg(overflowing({ clipsContent: false }), { margin: 0 });
  assert.match(open, /viewBox="150 10 200 40"/);
  const clipped = exportSvg(overflowing({ clipsContent: true }), { margin: 0 });
  assert.match(clipped, /viewBox="150 10 50 40"/);
});
