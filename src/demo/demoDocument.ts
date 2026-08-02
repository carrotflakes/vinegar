import { parseDocument } from "@/io/serialize";
import type { Document } from "@/model/types";

/**
 * The bundled demo drawing — a feature tour across five frames (cover, shapes
 * and paint, structure, effects, generators and path modifiers).
 *
 * It is authored as a real `.vinegar.json` file rather than as code, so it is
 * edited the way a user edits a drawing: open it, change it, save over
 * `src/demo/demo.vinegar.json`. Loading it through {@link parseDocument} means
 * the demo goes through the same validation as any opened file, so a file that
 * no longer matches `CURRENT_FILE_VERSION` fails loudly here instead of
 * silently drifting.
 *
 * The import is dynamic because the document is a few hundred kilobytes of
 * JSON that most sessions never open.
 */
export async function loadDemoDocument(): Promise<Document> {
  const { default: text } = await import("./demo.vinegar.json?raw");
  return parseDocument(text);
}
