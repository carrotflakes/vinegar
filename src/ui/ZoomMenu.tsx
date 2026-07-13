import { useEffect, useRef, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import {
  commandEnabled,
  commandShortcut,
  getCommand,
  runCommand,
} from "../commands/registry";
import { useEditor } from "../store/editorStore";

const ITEMS = [
  "view.reset",
  "view.fitSelection",
  "view.fitAll",
  "view.fitArtboard",
];

/** Zoom readout plus discoverable reset/fit navigation actions. */
export default function ZoomMenu() {
  const scale = useEditor((s) => s.viewport.scale);
  const [open, setOpen] = useState(false);
  // Subscribe to command enablement only while the menu is visible.
  const liveState = useEditor((s) => (open ? s : null));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        className={"bar-btn zoom-readout zoom-menu-trigger" + (open ? " active" : "")}
        onClick={() => setOpen((value) => !value)}
        title="Zoom and fit options"
        aria-label={`Zoom ${Math.round(scale * 100)}%. Open zoom and fit options`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{Math.round(scale * 100)}%</span>
        <LuChevronDown className="menu-caret" aria-hidden />
      </button>
      {open && (
        <div className="menu-popover zoom-menu-popover" role="menu">
          {ITEMS.map((id) => {
            const command = getCommand(id);
            if (!command) return null;
            const enabled = commandEnabled(command, liveState ?? undefined);
            const shortcut = commandShortcut(command);
            return (
              <button
                key={id}
                role="menuitem"
                className="menu-item zoom-menu-item"
                disabled={!enabled}
                onClick={() => {
                  setOpen(false);
                  runCommand(id);
                }}
              >
                <span>{command.label}</span>
                {shortcut && <span className="menu-shortcut">{shortcut}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
