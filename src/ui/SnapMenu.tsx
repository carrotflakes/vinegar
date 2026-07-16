import { useEffect, useRef, useState } from "react";
import { LuChevronDown, LuMagnet } from "react-icons/lu";
import { useEditor } from "../store/editorStore";
import ScrubbableNumber from "./ScrubbableNumber";
import { barButton } from "./AppBar.css";
import "./menus.css";
import "./SnapMenu.css";

/** Status-bar snapping control: a single magnet toggle that opens a popover
 * gathering the object/grid snap toggles and the grid size setting. */
export default function SnapMenu() {
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const gridSnap = useEditor((s) => s.gridSnap);
  const toggleGridSnap = useEditor((s) => s.toggleGridSnap);
  const gridSize = useEditor((s) => s.gridSize);
  const setGridSize = useEditor((s) => s.setGridSize);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = snapEnabled || gridSnap;

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
    <div className="menu-root snap-menu-root" ref={rootRef}>
      <button
        className={`${barButton()} snap-menu-trigger${active ? " is-active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        title="Snapping options"
        aria-label="Snapping options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <LuMagnet aria-hidden />
        <span>Snap</span>
        <LuChevronDown className="menu-caret" aria-hidden />
      </button>
      {open && (
        <div className="menu-popover snap-menu-popover" role="menu">
          <label className="snap-menu-row">
            <input
              type="checkbox"
              checked={snapEnabled}
              onChange={toggleSnap}
            />
            Snap to objects
          </label>
          <label className="snap-menu-row">
            <input
              type="checkbox"
              checked={gridSnap}
              onChange={toggleGridSnap}
            />
            Snap to grid
          </label>
          <div className="menu-divider" />
          <label className="snap-menu-row snap-menu-size">
            <span>Grid size</span>
            <ScrubbableNumber
              value={gridSize}
              onChange={setGridSize}
              min={1}
              step={1}
              className="grid-size-input"
              aria-label="Grid size"
            />
          </label>
        </div>
      )}
    </div>
  );
}
