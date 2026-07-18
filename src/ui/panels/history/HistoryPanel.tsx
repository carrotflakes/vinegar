import { useEffect, useRef } from "react";
import { useEditor } from "../../../store/editorStore";
import type { DocumentPatch } from "../../../store/documentPatches";
import type { HistoryEntry } from "../../../store/state";
import "../../Panel.css";
import "../layers/LayersPanel.css";
import "./HistoryPanel.css";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function mapPatch(patches: DocumentPatch[], field: DocumentPatch["field"]) {
  return patches.find((p) => p.field === field && p.type === "map") as
    | Extract<DocumentPatch, { type: "map" }>
    | undefined;
}

/**
 * A short human label for an undo step, derived from its patches. Nodes are the
 * common case, so we distinguish add / delete / edit by comparing the forward
 * `set`/`remove` against the inverse (an add's inverse is a remove).
 */
function labelForEntry(entry: HistoryEntry): string {
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

/**
 * Undo history as a scrubbable timeline. Rows run oldest→newest: a "Start" base,
 * the applied `past` steps, then the undone `future` steps (dimmed). Clicking a
 * row replays undo/redo until the document reaches that step.
 */
export default function HistoryPanel() {
  const past = useEditor((s) => s.history.past);
  const future = useEditor((s) => s.history.future);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  const current = past.length;
  const currentRef = useRef<HTMLDivElement>(null);

  // Keep the current step in view as the timeline changes.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [current, future.length]);

  const jumpTo = (target: number) => {
    if (target < current) for (let i = 0; i < current - target; i++) undo();
    else if (target > current) for (let i = 0; i < target - current; i++) redo();
  };

  const rows = [
    { key: "start", label: "Start", count: 0 },
    ...past.map((e, i) => ({
      key: `p${i}-${e.afterRevision}`,
      label: labelForEntry(e),
      count: i + 1,
    })),
    ...future.map((e, i) => ({
      key: `f${i}-${e.afterRevision}`,
      label: labelForEntry(e),
      count: current + 1 + i,
    })),
  ];

  return (
    <div className="layers">
      <div className="panel-title layers-title">
        <span>History</span>
      </div>
      <div className="layers-list">
        {rows.map((row) => {
          const isCurrent = row.count === current;
          const isFuture = row.count > current;
          return (
            <div
              key={row.key}
              ref={isCurrent ? currentRef : undefined}
              className={
                "history-row" +
                (isCurrent ? " current" : "") +
                (isFuture ? " future" : "")
              }
              onClick={() => jumpTo(row.count)}
              title={isCurrent ? "Current state" : "Jump to this step"}
            >
              <span className="history-dot" />
              <span className="history-label">{row.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
