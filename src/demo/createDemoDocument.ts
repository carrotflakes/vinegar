import { createEmptyDocument, makeArtboard, type DocumentAsset, type SceneNode } from "../model/types";
import { linearGradient, pattern, radialGradient, solid } from "../model/paint";
import { IDENTITY, multiply, rotation, translation } from "../model/matrix";

// A tiny seamless polka-dot tile, embedded as an SVG data URL so the demo has
// a texture asset without any external file. Dots at (6,6) and (18,18) on a
// 24-unit grid repeat evenly in every direction.
const DEMO_TEXTURE: DocumentAsset = {
  id: "demo_texture",
  kind: "image",
  mimeType: "image/svg+xml",
  name: "Demo dots",
  source: {
    type: "data",
    data:
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">` +
          `<rect width="24" height="24" fill="#f4d58d"/>` +
          `<circle cx="6" cy="6" r="4.2" fill="#d8b061"/>` +
          `<circle cx="18" cy="18" r="4.2" fill="#d8b061"/>` +
          `</svg>`
      ),
  },
};

const shapeBase = (
  name: string,
  fill: string | null,
  stroke: string | null = "#172033"
) => ({
  name,
  fill: fill ? solid(fill) : null,
  stroke: stroke ? solid(stroke) : null,
  strokeWidth: stroke ? 2 : 0,
  opacity: 1,
  transform: [...IDENTITY] as typeof IDENTITY,
  transformOrigin: null,
});

/**
 * A deterministic kitchen-sink document for visual regression and manual
 * debugging. Stable ids make it convenient to inspect in devtools/scripts.
 */
export function createDemoDocument() {
  const doc = createEmptyDocument();
  const nodes: Record<string, SceneNode> = {
    demo_background: {
      id: "demo_background", type: "rect", ...shapeBase("Background (locked)", "#f4f1ea", null),
      x: 32, y: 28, width: 920, height: 650, locked: true,
    },

    demo_header: {
      id: "demo_header", type: "group", name: "Header · group transform",
      childIds: [
        "demo_header_panel", "demo_header_orbit",
        "demo_header_curve", "demo_header_title", "demo_header_subtitle",
      ],
      transform: multiply(translation(82, 68), rotation(-0.035)),
      transformOrigin: { x: 410, y: 55 }, opacity: 1,
    },
    demo_header_panel: {
      id: "demo_header_panel", type: "rect", ...shapeBase("Rectangle · drop shadow effect", "#fffdf8", "#28344f"),
      x: 0, y: 0, width: 820, height: 112,
      effects: [
        { type: "drop-shadow", color: "#28344f", alpha: 0.24, blur: 0, offsetX: 7, offsetY: 11 },
      ],
    },
    demo_header_orbit: {
      id: "demo_header_orbit", type: "ellipse", ...shapeBase("Ellipse", "#ffcf5c", "#28344f"),
      x: 34, y: 22, width: 68, height: 68,
      transform: multiply(translation(0, 0), rotation(0.18)),
      transformOrigin: { x: 68, y: 56 },
    },
    demo_header_curve: {
      id: "demo_header_curve", type: "bezier", ...shapeBase("Open Bézier", null, "#e25555"),
      strokeWidth: 7,
      subpaths: [{
        anchors: [
          { p: { x: 142, y: 71 }, hIn: null, hOut: { x: 220, y: 8 } },
          { p: { x: 330, y: 55 }, hIn: { x: 262, y: 108 }, hOut: { x: 420, y: -4 } },
          { p: { x: 570, y: 64 }, hIn: { x: 480, y: 118 }, hOut: { x: 660, y: 14 } },
          { p: { x: 775, y: 46 }, hIn: { x: 705, y: 92 }, hOut: null },
        ],
        closed: false,
      }],
    },
    demo_header_title: {
      id: "demo_header_title", type: "text", ...shapeBase("Title · point text", "#28344f", null),
      text: "Vinegar", textMode: "point",
      x: 150, y: 14, width: 205, height: 59.8,
      fontFamily: "System Sans", fontSize: 52, fontWeight: 700,
      italic: false, lineHeight: 1.15, align: "left",
    },
    demo_header_subtitle: {
      id: "demo_header_subtitle", type: "text", ...shapeBase("Subtitle · italic serif", "#6f8ff7", null),
      text: "Kitchen-sink demo document", textMode: "point",
      x: 152, y: 74, width: 265, height: 24,
      fontFamily: "System Serif", fontSize: 20, fontWeight: 400,
      italic: true, lineHeight: 1.2, align: "left",
    },
    demo_spiky_callout: {
      id: "demo_spiky_callout", type: "group", name: "Spiky callout",
      childIds: ["demo_spiky_callout_shape", "demo_spiky_callout_cat", "demo_spiky_callout_text"],
      transform: multiply(translation(190, 20), rotation(0.2)), transformOrigin: null, opacity: 1,
    },
    demo_spiky_callout_shape: {
      id: "demo_spiky_callout_shape", type: "path",
      ...shapeBase("Spiky callout shape", "#ff3b30", "#111111"),
      strokeWidth: 8,
      strokeJoin: "miter",
      points: [
        { x: 528, y: 56 }, { x: 553, y: 47 }, { x: 537, y: 29 },
        { x: 568, y: 31 }, { x: 566, y: 7 }, { x: 593, y: 25 },
        { x: 612, y: 3 }, { x: 623, y: 24 }, { x: 657, y: 5 },
        { x: 663, y: 25 }, { x: 702, y: 7 }, { x: 701, y: 27 },
        { x: 744, y: 14 }, { x: 734, y: 35 }, { x: 784, y: 30 },
        { x: 756, y: 50 }, { x: 808, y: 59 }, { x: 758, y: 67 },
        { x: 788, y: 90 }, { x: 745, y: 79 }, { x: 747, y: 105 },
        { x: 709, y: 84 }, { x: 689, y: 108 }, { x: 672, y: 85 },
        { x: 636, y: 106 }, { x: 628, y: 84 }, { x: 588, y: 99 },
        { x: 593, y: 77 }, { x: 551, y: 83 }, { x: 566, y: 65 },
      ],
      closed: true,
    },
    demo_spiky_callout_cat: {
      id: "demo_spiky_callout_cat", type: "group", name: "Abstract cat",
      childIds: [
        "demo_spiky_callout_cat_head", "demo_spiky_callout_cat_eye_left",
        "demo_spiky_callout_cat_eye_right", "demo_spiky_callout_cat_nose",
      ],
      transform: [...IDENTITY], transformOrigin: null, opacity: 1,
    },
    demo_spiky_callout_cat_head: {
      id: "demo_spiky_callout_cat_head", type: "path",
      ...shapeBase("Cat head", "#fffdf8", "#111111"),
      strokeWidth: 3.5,
      strokeJoin: "round",
      points: [
        { x: 575, y: 81 }, { x: 575, y: 67 }, { x: 578, y: 53 },
        { x: 589, y: 60 }, { x: 598, y: 53 }, { x: 601, y: 67 },
        { x: 604, y: 74 }, { x: 601, y: 83 }, { x: 594, y: 90 },
        { x: 583, y: 90 }, { x: 577, y: 85 },
      ],
      closed: true,
    },
    demo_spiky_callout_cat_eye_left: {
      id: "demo_spiky_callout_cat_eye_left", type: "ellipse",
      ...shapeBase("Cat left eye", "#111111", null),
      x: 582, y: 70, width: 4, height: 6,
    },
    demo_spiky_callout_cat_eye_right: {
      id: "demo_spiky_callout_cat_eye_right", type: "ellipse",
      ...shapeBase("Cat right eye", "#111111", null),
      x: 593, y: 70, width: 4, height: 6,
    },
    demo_spiky_callout_cat_nose: {
      id: "demo_spiky_callout_cat_nose", type: "path",
      ...shapeBase("Cat nose", "#111111", null),
      points: [{ x: 587, y: 79 }, { x: 592, y: 79 }, { x: 589.5, y: 82 }],
      closed: true,
    },
    demo_spiky_callout_text: {
      id: "demo_spiky_callout_text", type: "text",
      ...shapeBase("Callout text", "#fffdf8", null),
      text: "にゃーん", textMode: "point",
      x: 613, y: 34, width: 136, height: 40.8,
      fontFamily: "System Sans", fontSize: 34, fontWeight: 700,
      italic: false, lineHeight: 1.2, align: "left",
    },

    demo_cards: {
      id: "demo_cards", type: "group", name: "Cards · nested groups + group drop shadow",
      childIds: ["demo_card_shapes", "demo_card_paths", "demo_card_boolean"],
      transform: translation(80, 220), transformOrigin: null, opacity: 1,
      // A group-level effect: one drop shadow lifts all three cards at once.
      effects: [
        { type: "drop-shadow", color: "#28344f", alpha: 0.18, blur: 14, offsetX: 5, offsetY: 9 },
      ],
    },
    demo_card_shapes: {
      id: "demo_card_shapes", type: "group", name: "Basic shapes",
      childIds: ["demo_card_a", "demo_skew_rect", "demo_circle_a", "demo_circle_b", "demo_locked_line"],
      transform: [...IDENTITY], transformOrigin: null, opacity: 1,
    },
    demo_card_a: {
      id: "demo_card_a", type: "rect", ...shapeBase("Card A · linear gradient", null, "#52617a"),
      fill: linearGradient(
        [{ offset: 0, color: "#dbe7ff", alpha: 1 }, { offset: 1, color: "#6f8ff7", alpha: 1 }],
        0.62
      ),
      x: 0, y: 0, width: 248, height: 174,
    },
    demo_skew_rect: {
      id: "demo_skew_rect", type: "rect", ...shapeBase("Skewed rectangle · explicit pivot", "#6f8ff7", null),
      x: 28, y: 34, width: 108, height: 70,
      transform: [1, 0.16, 0.22, 1, 0, 0], transformOrigin: { x: 150, y: 68 },
    },
    demo_circle_a: {
      id: "demo_circle_a", type: "ellipse", ...shapeBase("Multiply A", "#ff6b6b", null),
      x: 136, y: 76, width: 72, height: 72, opacity: 0.82, blendMode: "multiply",
    },
    demo_circle_b: {
      id: "demo_circle_b", type: "ellipse", ...shapeBase("Multiply B", "#48c9b0", null),
      x: 166, y: 76, width: 72, height: 72, opacity: 0.82, blendMode: "multiply",
    },
    demo_locked_line: {
      id: "demo_locked_line", type: "line", ...shapeBase("Line (locked)", null, "#28344f"),
      x1: 30, y1: 140, x2: 118, y2: 118, strokeWidth: 5, locked: true,
    },

    demo_card_paths: {
      id: "demo_card_paths", type: "group", name: "Paths · rotated nested group",
      childIds: ["demo_card_b", "demo_closed_path", "demo_open_path", "demo_blob"],
      transform: multiply(translation(285, 10), rotation(0.055)),
      transformOrigin: { x: 124, y: 87 }, opacity: 0.94,
    },
    demo_card_b: {
      id: "demo_card_b", type: "rect", ...shapeBase("Card B", "#fff4dc", "#52617a"),
      x: 0, y: 0, width: 248, height: 174,
    },
    demo_closed_path: {
      id: "demo_closed_path", type: "path", ...shapeBase("Closed path", "#f29b72", "#28344f"),
      points: [{ x: 28, y: 128 }, { x: 70, y: 54 }, { x: 112, y: 112 }, { x: 152, y: 42 }, { x: 218, y: 128 }],
      closed: true,
    },
    demo_open_path: {
      id: "demo_open_path", type: "path", ...shapeBase("Open path", null, "#3c6eeb"),
      strokeWidth: 5,
      points: [{ x: 28, y: 28 }, { x: 70, y: 18 }, { x: 112, y: 32 }, { x: 156, y: 16 }, { x: 218, y: 30 }],
      closed: false,
    },
    demo_blob: {
      id: "demo_blob", type: "bezier", ...shapeBase("Closed Bézier · radial gradient", null, "#28344f"),
      fill: radialGradient([
        { offset: 0, color: "#fff0a8", alpha: 1 },
        { offset: 1, color: "#f2932f", alpha: 1 },
      ]),
      subpaths: [{
        anchors: [
          { p: { x: 92, y: 70 }, hIn: { x: 63, y: 54 }, hOut: { x: 120, y: 42 } },
          { p: { x: 180, y: 84 }, hIn: { x: 154, y: 48 }, hOut: { x: 196, y: 113 } },
          { p: { x: 122, y: 142 }, hIn: { x: 166, y: 142 }, hOut: { x: 82, y: 140 } },
        ],
        closed: true,
      }],
    },

    demo_card_boolean: {
      id: "demo_card_boolean", type: "group", name: "Compound path · opacity + blend group",
      childIds: ["demo_card_c", "demo_compound_path", "demo_polygon_accent"],
      transform: translation(570, 0), transformOrigin: null, opacity: 0.9, blendMode: "multiply",
    },
    demo_card_c: {
      id: "demo_card_c", type: "rect", ...shapeBase("Card C", "#e8fbf5", "#52617a"),
      x: 0, y: 0, width: 248, height: 174,
    },
    demo_compound_path: {
      id: "demo_compound_path", type: "compoundPath",
      ...shapeBase("Compound Path · retained path + ellipse", "#3abf9c", "#1c6457"),
      fillRule: "evenodd",
      components: [
        {
          id: "demo_compound_outer", type: "path",
          ...shapeBase("Retained outer path", "#f29b72", "#28344f"),
          points: [
            { x: 28, y: 42 }, { x: 72, y: 26 }, { x: 124, y: 34 },
            { x: 218, y: 62 }, { x: 184, y: 138 }, { x: 92, y: 146 },
            { x: 46, y: 112 },
          ],
          closed: true,
        },
        {
          id: "demo_compound_hole", type: "ellipse",
          ...shapeBase("Retained ellipse hole", "#ffcf5c", null),
          x: 82, y: 62, width: 82, height: 54,
          transform: multiply(translation(2, -1), rotation(0.08)),
          transformOrigin: { x: 123, y: 89 },
        },
      ],
    },
    demo_polygon_accent: {
      id: "demo_polygon_accent", type: "polygon", ...shapeBase("Multi-polygon", "#725ac1", null),
      polys: [
        [[{ x: 44, y: 44 }, { x: 68, y: 44 }, { x: 56, y: 66 }]],
        [[{ x: 178, y: 120 }, { x: 204, y: 120 }, { x: 191, y: 142 }]],
      ],
    },

    demo_footer: {
      id: "demo_footer", type: "group", name: "Transform playground",
      childIds: ["demo_footer_panel", "demo_rotated_rect", "demo_dash_line", "demo_footer_ellipse"],
      transform: translation(80, 440), transformOrigin: null, opacity: 1,
    },
    demo_footer_panel: {
      id: "demo_footer_panel", type: "rect", ...shapeBase("Footer panel · pattern fill", null, null),
      fill: pattern("demo_texture"),
      x: 0, y: 0, width: 818, height: 172,
    },
    demo_rotated_rect: {
      id: "demo_rotated_rect", type: "rect", ...shapeBase("Rotated rectangle · pattern fill + pivot", null, "#fff8e8"),
      fill: pattern("demo_texture", { scale: 1.6, rotation: 0.35 }),
      x: 56, y: 48, width: 170, height: 72,
      transform: multiply(translation(18, -8), rotation(-0.22)), transformOrigin: { x: 40, y: 138 },
    },
    demo_dash_line: {
      id: "demo_dash_line", type: "line", ...shapeBase("Textured stroke line", null, "#8aa4ff"),
      stroke: pattern("demo_texture", { scale: 0.3 }),
      x1: 302, y1: 42, x2: 514, y2: 130, strokeWidth: 12, opacity: 0.5, blendMode: "exclusion",
      strokeDash: [14, 16], strokeDashOffset: 6, strokeCap: "round",
    },
    demo_footer_ellipse: {
      id: "demo_footer_ellipse", type: "ellipse", ...shapeBase("Scaled ellipse · blur effect", "#f26d85", null),
      x: 580, y: 4, width: 200, height: 100,
      transform: [1.12, 0.18, -0.08, 0.82, 0, 0], transformOrigin: null, blendMode: "screen",
      // Blur under a skew transform and a screen blend: a soft glowing accent.
      effects: [{ type: "blur", radius: 6 }],
    },

    demo_caption: {
      id: "demo_caption", type: "text", ...shapeBase("Caption · area (wrapping) text", "#52617a", null),
      text: "A deterministic kitchen-sink document that exercises every shape type — including text — across nested transforms, blends, gradients, patterns, and non-destructive effects (drop shadow & blur).",
      textMode: "area",
      x: 48, y: 624, width: 872, height: 48.6,
      fontFamily: "System Sans", fontSize: 18, fontWeight: 400,
      italic: false, lineHeight: 1.35, align: "left",
    },

    demo_empty_group: {
      id: "demo_empty_group", type: "group", name: "Empty group (valid)", childIds: [],
      transform: translation(900, 630), transformOrigin: { x: 0, y: 0 }, opacity: 1,
    },
    demo_hidden: {
      id: "demo_hidden", type: "rect", ...shapeBase("Hidden debug node", "#ff00ff", null),
      x: 860, y: 610, width: 60, height: 30, hidden: true,
    },
  };

  doc.assets = { [DEMO_TEXTURE.id]: DEMO_TEXTURE };
  doc.nodes = nodes;
  doc.rootIds = [
    "demo_background",
    "demo_header",
    "demo_cards",
    "demo_footer",
    "demo_caption",
    "demo_spiky_callout",
    "demo_empty_group",
    "demo_hidden",
  ];
  doc.artboards = [makeArtboard(16, 12, 952, 682, "Poster")];
  doc.settings.gridSize = 40;
  doc.extensions["vinegar.demo"] = {
    purpose: "manual-debugging",
    features: ["all-shape-types", "compound-path", "nested-groups", "empty-group", "transforms", "pivots", "blend", "hidden", "locked", "pattern-fill", "pattern-stroke", "linear-gradient", "radial-gradient", "point-text", "area-text", "spiky-callout", "abstract-cat", "thick-stroke", "drop-shadow-effect", "group-effect", "blur-effect"],
  };
  return doc;
}
