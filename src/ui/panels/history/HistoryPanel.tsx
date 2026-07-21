import { useEffect, useRef } from "react";
import { LuSearch } from "react-icons/lu";
import { useEditor } from "../../../store/editorStore";
import { useUi } from "../../../store/uiStore";
import "../../Panel.css";
import "../PanelList.css";
import "./HistoryPanel.css";
import { labelForEntry } from "./historyLabels";

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
  const openInspector = useUi((s) => s.openInspector);

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
    { key: "start", label: "Start", count: 0, inspectPath: ["history"] },
    ...past.map((e, i) => ({
      key: `p${i}-${e.afterRevision}`,
      label: labelForEntry(e),
      count: i + 1,
      inspectPath: ["history", "past", String(i)],
    })),
    ...future.map((e, i) => ({
      key: `f${i}-${e.afterRevision}`,
      label: labelForEntry(e),
      count: current + 1 + i,
      inspectPath: ["history", "future", String(i)],
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
              <button
                type="button"
                className="history-inspect"
                onClick={(event) => {
                  event.stopPropagation();
                  openInspector(row.inspectPath);
                }}
                title="Inspect history entry"
                aria-label={`Inspect ${row.label}`}
              >
                <LuSearch aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
