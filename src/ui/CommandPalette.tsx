import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMMANDS,
  commandEnabled,
  commandShortcut,
  runCommand,
  type Command,
} from "../commands/registry";
import { useEditor } from "../store/editorStore";
import "./Modal.css";
import "./CommandPalette.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Case-insensitive subsequence match — the fuzzy feel without a dependency. */
function matches(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return i === q.length;
}

/**
 * Command palette (Ctrl/⌘+K). Fuzzy-filters every registered command, shows its
 * shortcut and live enabled state, and runs the highlighted one on Enter. It is
 * built entirely from the command registry, so new commands appear here for
 * free.
 */
const ONLY_ENABLED_KEY = "vinegar.palette.onlyEnabled";

export default function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Persist the "available only" preference so it survives across sessions.
  const [onlyEnabled, setOnlyEnabled] = useState(
    () => localStorage.getItem(ONLY_ENABLED_KEY) === "1"
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Subscribe to the store only while open, so enabled/disabled state reflects
  // the current selection without re-rendering on every edit when closed.
  const state = useEditor((s) => (open ? s : null));

  const results = useMemo(() => {
    const list = COMMANDS.filter(
      (c) => !c.hidden && matches(query, `${c.group} ${c.label}`)
    ).map((cmd) => ({
      cmd,
      enabled: commandEnabled(cmd, state ?? undefined),
    }));
    return onlyEnabled ? list.filter((r) => r.enabled) : list;
  }, [query, state, onlyEnabled]);

  const toggleOnlyEnabled = () => {
    setOnlyEnabled((v) => {
      const next = !v;
      localStorage.setItem(ONLY_ENABLED_KEY, next ? "1" : "0");
      return next;
    });
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Focus after the element mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  const run = (cmd: Command, enabled: boolean) => {
    if (!enabled) return;
    onClose();
    runCommand(cmd.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) run(hit.cmd, hit.enabled);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  // Keep the active row scrolled into view.
  const setActiveRef = (el: HTMLButtonElement | null, isActive: boolean) => {
    if (isActive && el) el.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="modal-overlay" onPointerDown={onClose}>
      <div
        className="modal palette-modal"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="palette-header">
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className={
              "palette-filter" + (onlyEnabled ? " active" : "")
            }
            aria-pressed={onlyEnabled}
            title="Show only commands available right now"
            onClick={toggleOnlyEnabled}
          >
            Available only
          </button>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {results.length === 0 && (
            <div className="palette-empty">No matching commands</div>
          )}
          {results.map(({ cmd, enabled }, i) => {
            const isActive = i === active;
            const shortcut = commandShortcut(cmd);
            return (
              <button
                key={cmd.id}
                ref={(el) => setActiveRef(el, isActive)}
                role="option"
                aria-selected={isActive}
                className={
                  "palette-item" +
                  (isActive ? " active" : "") +
                  (enabled ? "" : " disabled")
                }
                disabled={!enabled}
                onPointerEnter={() => setActive(i)}
                onClick={() => run(cmd, enabled)}
              >
                <span className="palette-group">{cmd.group}</span>
                <span className="palette-label">{cmd.label}</span>
                {shortcut && <span className="palette-shortcut">{shortcut}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
