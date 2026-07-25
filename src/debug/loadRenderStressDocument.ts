import { createRenderStressDocument } from "@/demo/createRenderStressDocument";
import { useEditor } from "@/store/editorStore";
import { renderStressNodeCount } from "./renderFlags";

/**
 * Replace the startup document with a deterministic render stress scene when
 * `?renderStress=1000|10000` is present. A no-op otherwise, and in production.
 */
export function loadRenderStressDocument(): void {
  if (!renderStressNodeCount) return;
  const editor = useEditor.getState();
  editor.loadDocument(createRenderStressDocument(renderStressNodeCount));
  editor.setViewport({ scale: 1, rotation: 0, offset: { x: 8, y: 8 } });
}
