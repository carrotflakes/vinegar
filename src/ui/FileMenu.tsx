import { useEffect, useRef, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { commandEnabled, getCommand, runCommand } from "../commands/registry";
import { barButton } from "./AppBar.css";
import "./menus.css";

// Menu layout, defined explicitly so the File menu can be organised into
// groups and submenus rather than mirroring registry order. Leaves reference
// commands by id, so labels and enabled state stay in sync with the registry.
type MenuNode =
  | { kind: "item"; id: string }
  | { kind: "separator" }
  | { kind: "preferences"; label: string }
  | { kind: "submenu"; label: string; items: string[] };

const MENU: MenuNode[] = [
  { kind: "item", id: "file.new" },
  { kind: "item", id: "file.open" },
  { kind: "item", id: "file.importSvg" },
  { kind: "item", id: "file.placeImage" },
  { kind: "separator" },
  { kind: "item", id: "file.save" },
  {
    kind: "submenu",
    label: "Export",
    items: [
      "file.exportPng",
      "file.exportSvg",
      "file.exportArtboardPng",
      "file.exportArtboardSvg",
      "file.exportAllArtboardsPng",
    ],
  },
  { kind: "separator" },
  { kind: "preferences", label: "Preferences…" },
];

// Inside the Export submenu the "Export " prefix is redundant with the parent.
function subLabel(label: string): string {
  return label.replace(/^Export /, "");
}

export default function FileMenu({
  onOpenPreferences,
}: {
  onOpenPreferences: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setSubmenu(null);
  };

  // Dismiss on outside press or Escape (pointerdown, not mousedown — the
  // canvas captures pointers, which suppresses compatibility mouse events).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const runLeaf = (id: string) => {
    close();
    runCommand(id);
  };

  const leaf = (id: string, label?: string) => {
    const cmd = getCommand(id);
    if (!cmd) return null;
    return (
      <button
        key={id}
        role="menuitem"
        className="menu-item"
        disabled={!commandEnabled(cmd)}
        onClick={() => runLeaf(id)}
      >
        {label ?? cmd.label}
      </button>
    );
  };

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        className={barButton({ active: open })}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        File <LuChevronDown className="menu-caret" aria-hidden />
      </button>
      {open && (
        <div className="menu-popover" role="menu">
          {MENU.map((node, i) => {
            if (node.kind === "separator") {
              return <div key={`sep-${i}`} className="menu-divider" />;
            }
            if (node.kind === "item") {
              return leaf(node.id);
            }
            if (node.kind === "preferences") {
              return (
                <button
                  key="preferences"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    onOpenPreferences();
                  }}
                >
                  {node.label}
                </button>
              );
            }
            const isOpen = submenu === node.label;
            return (
              <div
                key={node.label}
                className="menu-sub"
                onMouseEnter={() => setSubmenu(node.label)}
                onMouseLeave={() => setSubmenu(null)}
              >
                <button
                  role="menuitem"
                  className={"menu-item submenu-trigger" + (isOpen ? " active" : "")}
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                >
                  {node.label}
                  <LuChevronRight className="menu-caret" aria-hidden />
                </button>
                {isOpen && (
                  <div className="menu-popover menu-popover-sub" role="menu">
                    {node.items.map((id) => leaf(id, subLabel(getCommand(id)?.label ?? "")))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
