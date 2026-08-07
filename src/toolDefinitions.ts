// Shared metadata for editor tools. The toolbar and command registry both
// derive from this list, so adding or reordering a tool only has one source of
// truth for its identity, label, shortcut and visual grouping.
//
// Grouped by what a tool does: select/edit, shape makers, freehand drawing,
// paint application, then frames. Bucket stays with the drawing tools because
// it grows a new path from surrounding ink; gradient gets its own group because
// it changes paint on existing artwork without creating geometry.

export const TOOL_DEFINITIONS = [
  { id: "select", label: "Select", key: "v" },
  { id: "node", label: "Edit Nodes", key: "n" },
  { id: "rect", label: "Rectangle", key: "r", groupBefore: true },
  { id: "ellipse", label: "Ellipse", key: "o" },
  { id: "line", label: "Line", key: "l" },
  { id: "text", label: "Text", key: "t" },
  { id: "pen", label: "Pen", key: "p", groupBefore: true },
  { id: "pencil", label: "Pencil", key: "b", shift: true },
  { id: "brush", label: "Brush", key: "b" },
  { id: "eraser", label: "Eraser", key: "e" },
  { id: "bucket", label: "Bucket Fill", key: "g" },
  { id: "gradient", label: "Gradient", key: "g", shift: true, groupBefore: true },
  { id: "frame", label: "Frame", key: "a", groupBefore: true },
] as const;

export type ToolDefinition = (typeof TOOL_DEFINITIONS)[number];
export type ToolId = ToolDefinition["id"];

export function toolStartsGroup(tool: ToolDefinition): boolean {
  return "groupBefore" in tool && tool.groupBefore;
}

export function toolKeyStroke(tool: ToolDefinition): {
  key: string;
  shift?: true;
} {
  return "shift" in tool && tool.shift
    ? { key: tool.key, shift: true }
    : { key: tool.key };
}

export function toolShortcutHint(tool: ToolDefinition): string {
  return `${"shift" in tool && tool.shift ? "⇧" : ""}${tool.key.toUpperCase()}`;
}
