import type { DocumentPatch } from "../../../store/documentPatches";
import type { HistoryEntry } from "../../../store/state";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function mapPatch(patches: DocumentPatch[], field: DocumentPatch["field"]) {
  return patches.find((p) => p.field === field && p.type === "map") as
    | Extract<DocumentPatch, { type: "map" }>
    | undefined;
}

/** Return an explicit semantic label, or derive a generic one from patches. */
export function labelForEntry(entry: HistoryEntry): string {
  if (entry.label) return entry.label;
  const { patches, inversePatches } = entry;
  const nodes = mapPatch(patches, "nodes");
  if (nodes) {
    const invRemove = new Set(mapPatch(inversePatches, "nodes")?.remove ?? []);
    const setKeys = nodes.set.map(([k]) => k);
    const added = setKeys.filter((k) => invRemove.has(k)).length;
    const modified = setKeys.length - added;
    const deleted = nodes.remove.length;
    if (added && !modified && !deleted) return `Add ${plural(added, "shape")}`;
    if (deleted && !added && !modified)
      return `Delete ${plural(deleted, "shape")}`;
    if (modified && !added && !deleted)
      return `Edit ${plural(modified, "shape")}`;
    return "Edit shapes";
  }
  if (mapPatch(patches, "symbols")) return "Edit symbol";
  if (patches.some((p) => p.field === "artboards")) return "Edit artboards";
  if (patches.some((p) => p.field === "rootIds")) return "Reorder";
  if (patches.some((p) => p.field === "settings")) return "Document settings";
  if (mapPatch(patches, "assets")) return "Edit assets";
  if (patches.some((p) => p.field === "metadata")) return "Edit metadata";
  return "Change";
}
