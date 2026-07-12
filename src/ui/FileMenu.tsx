import { useEffect, useRef, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { COMMANDS, runCommand } from "../commands/registry";

// File-group commands, in registry order, with separators before the Save and
// Demo groups to match the previous layout.
const FILE_ITEMS = COMMANDS.filter((c) => c.group === "File").map((c) => ({
  id: c.id,
  label: c.label,
  separatorBefore: c.id === "file.save" || c.id === "file.demo",
}));

export default function FileMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside press or Escape (pointerdown, not mousedown — the
  // canvas captures pointers, which suppresses compatibility mouse events).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        className={"bar-btn" + (open ? " active" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        File <LuChevronDown className="menu-caret" aria-hidden />
      </button>
      {open && (
        <div className="menu-popover" role="menu">
          {FILE_ITEMS.map((item) => (
            <button
              key={item.id}
              role="menuitem"
              className={"menu-item" + (item.separatorBefore ? " sep" : "")}
              onClick={() => {
                setOpen(false);
                runCommand(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
