import type { Document, SceneNode } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";

/** Human-readable kind of a node, as shown in the properties header. */
export function nodeKindLabel(node: SceneNode): string {
  switch (node.type) {
    case "rect":
      return "Rectangle";
    case "ellipse":
      return "Ellipse";
    case "line":
      return "Line";
    case "path":
      return "Path";
    case "compoundPath":
      return "Compound path";
    case "image":
      return "Image";
    case "text":
      return "Text";
    case "brush":
      return "Brush";
    case "group":
      return "Group";
    case "frame":
      return "Frame";
    case "instance":
      return "Symbol instance";
  }
}

/**
 * What the rest of the panel is about: the kind of the selection and, for a
 * single node, its editable name. Sections below only carry their own topic
 * ("Appearance", "Transform"), so the identity is stated once, here.
 */
export default function SelectionHeader({
  doc,
  rootIds,
}: {
  doc: Document;
  rootIds: string[];
}) {
  const rename = useEditor((state) => state.renameNode);
  const node = rootIds.length === 1 ? doc.nodes[rootIds[0]] : undefined;

  return (
    <div className="section selection-header">
      <div className="section-title">
        {node
          ? nodeKindLabel(node)
          : rootIds.length === 0
            ? "No selection"
            : `${rootIds.length} selected`}
      </div>
      {node && (
        <input
          type="text"
          className="selection-name"
          value={node.name}
          aria-label="Name"
          onChange={(event) => rename(node.id, event.target.value)}
        />
      )}
    </div>
  );
}
