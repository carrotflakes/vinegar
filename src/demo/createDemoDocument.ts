import { createEmptyDocument, makeArtboard, type SceneNode } from "../model/types";
import { solid } from "../model/paint";
import { IDENTITY, multiply, rotation, translation } from "../model/matrix";

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
      childIds: ["demo_header_shadow", "demo_header_panel", "demo_header_orbit", "demo_header_curve"],
      transform: multiply(translation(82, 68), rotation(-0.035)),
      transformOrigin: { x: 410, y: 55 }, opacity: 1,
    },
    demo_header_shadow: {
      id: "demo_header_shadow", type: "rect", ...shapeBase("Shadow · opacity", "#28344f", null),
      x: 8, y: 10, width: 820, height: 112, opacity: 0.18,
    },
    demo_header_panel: {
      id: "demo_header_panel", type: "rect", ...shapeBase("Rectangle", "#fffdf8", "#28344f"),
      x: 0, y: 0, width: 820, height: 112,
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

    demo_cards: {
      id: "demo_cards", type: "group", name: "Cards · nested groups",
      childIds: ["demo_card_shapes", "demo_card_paths", "demo_card_boolean"],
      transform: translation(80, 220), transformOrigin: null, opacity: 1,
    },
    demo_card_shapes: {
      id: "demo_card_shapes", type: "group", name: "Basic shapes",
      childIds: ["demo_card_a", "demo_skew_rect", "demo_circle_a", "demo_circle_b", "demo_locked_line"],
      transform: [...IDENTITY], transformOrigin: null, opacity: 1,
    },
    demo_card_a: {
      id: "demo_card_a", type: "rect", ...shapeBase("Card A", "#e8f0ff", "#52617a"),
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
      id: "demo_blob", type: "bezier", ...shapeBase("Closed Bézier", "#ffd15c", "#28344f"),
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
      id: "demo_footer_panel", type: "rect", ...shapeBase("Footer panel", "#222b45", null),
      x: 0, y: 0, width: 818, height: 172,
    },
    demo_rotated_rect: {
      id: "demo_rotated_rect", type: "rect", ...shapeBase("Rotated rectangle · off-center pivot", "#ffcf5c", "#fff8e8"),
      x: 56, y: 48, width: 170, height: 72,
      transform: multiply(translation(18, -8), rotation(-0.22)), transformOrigin: { x: 40, y: 138 },
    },
    demo_dash_line: {
      id: "demo_dash_line", type: "line", ...shapeBase("Long line", null, "#8aa4ff"),
      x1: 285, y1: 42, x2: 514, y2: 130, strokeWidth: 8, opacity: 0.75,
    },
    demo_footer_ellipse: {
      id: "demo_footer_ellipse", type: "ellipse", ...shapeBase("Scaled ellipse", "#f26d85", null),
      x: 610, y: 44, width: 118, height: 78,
      transform: [1.12, 0.18, -0.08, 0.82, 0, 0], transformOrigin: null, blendMode: "screen",
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

  doc.nodes = nodes;
  doc.rootIds = [
    "demo_background",
    "demo_header",
    "demo_cards",
    "demo_footer",
    "demo_empty_group",
    "demo_hidden",
  ];
  doc.artboards = [makeArtboard(16, 12, 952, 682, "Poster")];
  doc.settings.gridSize = 40;
  doc.extensions["vinegar.demo"] = {
    purpose: "manual-debugging",
    features: ["all-shape-types", "compound-path", "nested-groups", "empty-group", "transforms", "pivots", "blend", "hidden", "locked"],
  };
  return doc;
}
