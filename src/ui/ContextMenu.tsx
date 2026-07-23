import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isSubmenu, useMenu, type MenuEntry } from "../store/menuStore";
import "./ContextMenu.css";

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
      <EntryList entries={entries} onClose={onClose} />
    </div>
  );
}

/** Renders a list of entries (shared by the root menu and every submenu). */
function EntryList({
  entries,
  onClose,
}: {
  entries: MenuEntry[];
  onClose: () => void;
}) {
  return (
    <>
      {entries.map((entry, i) =>
        entry === "separator" ? (
          <div key={i} className="context-menu-sep" />
        ) : isSubmenu(entry) ? (
          <SubmenuItem key={i} entry={entry} onClose={onClose} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={"context-menu-item" + (entry.danger ? " danger" : "")}
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
    </>
  );
}

/** A parent item that expands its nested menu to the side on hover. */
function SubmenuItem({
  entry,
  onClose,
}: {
  entry: Extract<MenuEntry, { submenu: MenuEntry[] }>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Flip to the left when the submenu would overflow the right edge.
  const [side, setSide] = useState<"right" | "left">("right");

  useLayoutEffect(() => {
    if (!open) return;
    const item = ref.current;
    const panel = panelRef.current;
    if (!item || !panel) return;
    const r = item.getBoundingClientRect();
    const w = panel.getBoundingClientRect().width;
    setSide(r.right + w + 4 > window.innerWidth ? "left" : "right");
  }, [open]);

  return (
    <div
      ref={ref}
      className="context-menu-subitem"
      onPointerEnter={() => !entry.disabled && setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <button
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="context-menu-item"
        disabled={entry.disabled}
      >
        <span className="context-menu-label">{entry.label}</span>
        <span className="context-menu-caret" aria-hidden>
          ▸
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          className="context-menu context-menu-nested"
          role="menu"
          style={side === "right" ? { left: "100%" } : { right: "100%" }}
        >
          <EntryList entries={entry.submenu} onClose={onClose} />
        </div>
      )}
    </div>
  );
}
