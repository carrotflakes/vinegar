import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMenu, type MenuEntry } from "../store/menuStore";

/** Renders the app-wide context menu; mount once at the App root. */
export default function ContextMenuHost() {
  const menu = useMenu((s) => s.menu);
  const closeMenu = useMenu((s) => s.closeMenu);
  if (!menu) return null;
  return (
    <Menu
      key={`${menu.x},${menu.y}`}
      x={menu.x}
      y={menu.y}
      entries={menu.entries}
      onClose={closeMenu}
    />
  );
}

interface MenuProps {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
}

function Menu({ x, y, entries, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp into the viewport once the menu has a size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture phase: swallow it so global handlers (clear selection)
        // only see Escape when no menu is open.
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        entry === "separator" ? (
          <div key={i} className="context-menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={
              "context-menu-item" + (entry.danger ? " danger" : "")
            }
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
          >
            <span className="context-menu-label">{entry.label}</span>
            {entry.shortcut && (
              <span className="context-menu-shortcut">{entry.shortcut}</span>
            )}
          </button>
        )
      )}
    </div>
  );
}
