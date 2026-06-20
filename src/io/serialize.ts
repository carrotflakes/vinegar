import type { Document, Shape, ShapeType } from "../model/types";

/** On-disk file wrapper for a Vinegar document. */
export interface VinegarFile {
  app: "vinegar";
  version: 1;
  document: Document;
}

export function serializeDocument(doc: Document): string {
  const file: VinegarFile = { app: "vinegar", version: 1, document: doc };
  return JSON.stringify(file, null, 2);
}

const SHAPE_TYPES: ShapeType[] = ["rect", "ellipse", "line", "path", "bezier"];

/**
 * Parse a `.vinegar.json` file back into a Document. Throws on anything
 * that does not look like a valid document.
 */
export function parseDocument(text: string): Document {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (!data || typeof data !== "object") {
    throw new Error("Unexpected file contents.");
  }
  const file = data as Partial<VinegarFile>;
  if (file.app !== "vinegar") {
    throw new Error("Not a Vinegar file.");
  }
  const doc = file.document;
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.order) || !doc.shapes) {
    throw new Error("Document data is missing or malformed.");
  }

  // Keep only well-formed shapes that are referenced by `order`.
  const shapes: Record<string, Shape> = {};
  for (const id of doc.order) {
    const s = doc.shapes[id];
    if (s && typeof s === "object" && SHAPE_TYPES.includes((s as Shape).type)) {
      // Default fields that may be absent in files from older versions.
      const shape = s as Shape;
      shapes[id] = { ...shape, rotation: shape.rotation ?? 0 };
    }
  }
  const order = doc.order.filter((id) => shapes[id]);
  return { shapes, order };
}
