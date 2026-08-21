import { IDENTITY } from "@/model/geometry/matrix";
import {
  baseNodeDefaults,
  baseShapeDefaults,
  createEmptyDocument,
  type Document,
  type Group,
  type SceneNode,
  type Shape,
} from "../model/types";
import { solid } from "../model/paint";

export type RenderStressNodeCount = 1_000 | 10_000;

const COLORS = [
  "#4f46e5",
  "#0891b2",
  "#059669",
  "#ca8a04",
  "#dc2626",
  "#9333ea",
];

function shapeBase(index: number) {
  const outsideStroke = index % 53 === 0;
  return {
    ...baseShapeDefaults(),
    ...baseNodeDefaults(),
    name: `Stress shape ${index}`,
    fill: solid(COLORS[index % COLORS.length]),
    stroke: outsideStroke ? solid("#172033") : null,
    strokeWidth: outsideStroke ? 5 : 0,
    strokeAlignment: outsideStroke ? "outside" as const : "center" as const,
    transform: [...IDENTITY] as Shape["transform"],
    effects:
      index % 211 === 0
        ? [
            {
              // Deterministic ids keep the stress document byte-identical
              // across runs (`makeId` is random).
              id: `fx_shape_${index}`,
              enabled: true,
              type: "drop-shadow" as const,
              color: "#172033",
              alpha: 0.32,
              blur: 7,
              offsetX: 4,
              offsetY: 5,
            },
          ]
        : [],
  };
}

function stressShape(index: number, x: number, y: number): Shape {
  const base = shapeBase(index);
  if (index % 40 === 0) {
    return {
      id: `stress_shape_${index}`,
      type: "text",
      ...base,
      text: `N${index}`,
      textMode: "point",
      x,
      y,
      width: 22,
      height: 14.4,
      fontFamily: "System Sans",
      fontSize: 12,
      fontWeight: 500,
      italic: false,
      lineHeight: 1.2,
      align: "left",
    };
  }
  if (index % 4 === 0) {
    return {
      id: `stress_shape_${index}`,
      type: "path",
      ...base,
      fillRule: "nonzero",
      subpaths: [
        {
          anchors: [
            {
              p: { x, y: y + 11 },
              hIn: { x: x - 2, y: y + 5 },
              hOut: { x: x + 3, y: y + 2 },
            },
            {
              p: { x: x + 11, y },
              hIn: { x: x + 5, y: y - 1 },
              hOut: { x: x + 17, y: y + 1 },
            },
            {
              p: { x: x + 22, y: y + 11 },
              hIn: { x: x + 20, y: y + 4 },
              hOut: { x: x + 20, y: y + 18 },
            },
            {
              p: { x: x + 11, y: y + 22 },
              hIn: { x: x + 17, y: y + 23 },
              hOut: { x: x + 4, y: y + 21 },
            },
          ],
          closed: true,
        },
      ],
    };
  }
  if (index % 4 === 1) {
    return {
      id: `stress_shape_${index}`,
      type: "ellipse",
      ...base,
      x,
      y,
      width: 22,
      height: 22,
    };
  }
  return {
    id: `stress_shape_${index}`,
    type: "rect",
    ...base,
    x,
    y,
    width: 22,
    height: 22,
    cornerRadius: index % 8 === 2 ? 5 : 0,
  };
}

/**
 * Deterministic 1k/10k-node scene used for Canvas render profiling.
 *
 * The document is intentionally much larger than the viewport, mixes paths,
 * text, outside strokes and effects, and batches leaves into effect/opacity
 * groups. It exercises both JS path/layout work and full-canvas compositing.
 */
export function createRenderStressDocument(
  nodeCount: RenderStressNodeCount = 10_000
): Document {
  const doc = createEmptyDocument();
  const nodes: Record<string, SceneNode> = {};
  const rootIds: string[] = [];
  const columns = Math.ceil(Math.sqrt(nodeCount));
  const spacing = 34;
  const groupSize = 100;

  for (let groupIndex = 0; groupIndex < Math.ceil(nodeCount / groupSize); groupIndex++) {
    const groupId = `stress_group_${groupIndex}`;
    const childIds: string[] = [];
    const group: Group = {
      id: groupId,
      type: "group",
      clipsToMask: false,
      name: `Stress group ${groupIndex}`,
      childIds,
      ...baseNodeDefaults(),
      transform: [...IDENTITY],
      opacity: groupIndex % 13 === 0 ? 0.86 : 1,
      blendMode: groupIndex % 13 === 0 ? "multiply" : "normal",
      effects:
        groupIndex % 8 === 0
          ? [
              {
                id: `fx_group_${groupIndex}`,
                enabled: true,
                type: "drop-shadow",
                color: "#0f172a",
                alpha: 0.2,
                blur: 10,
                offsetX: 6,
                offsetY: 8,
              },
            ]
          : [],
    };

    const start = groupIndex * groupSize;
    const end = Math.min(start + groupSize, nodeCount);
    for (let index = start; index < end; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const shape = stressShape(index, 16 + column * spacing, 16 + row * spacing);
      nodes[shape.id] = shape;
      childIds.push(shape.id);
    }
    nodes[groupId] = group;
    rootIds.push(groupId);
  }

  doc.nodes = nodes;
  doc.rootIds = rootIds;
  doc.settings.gridSize = spacing;
  doc.extensions["vinegar.render-stress"] = {
    version: 1,
    leafNodeCount: nodeCount,
    groupCount: rootIds.length,
    columns,
    spacing,
    features: [
      "large-offscreen-scene",
      "bezier-paths",
      "text-layout",
      "outside-strokes",
      "shape-effects",
      "group-effects",
      "opacity-groups",
    ],
  };
  return doc;
}
