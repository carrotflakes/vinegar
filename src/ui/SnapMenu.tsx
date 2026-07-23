import { LuChevronDown, LuMagnet } from "react-icons/lu";
import { useEditor } from "../store/editorStore";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import { barButton } from "./AppBar.css";
import { Popover } from "./menu/Popover";
import "./menus.css";
import "./SnapMenu.css";

/** Status-bar snapping control: a single magnet toggle that opens a popover
 * gathering the object/grid snap toggles and the grid size setting. */
export default function SnapMenu() {
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const gridSnap = useEditor((s) => s.gridSnap);
  const toggleGridSnap = useEditor((s) => s.toggleGridSnap);
  const gridVisible = useEditor((s) => s.gridVisible);
  const toggleGridVisible = useEditor((s) => s.toggleGridVisible);
  const gridSize = useEditor((s) => s.gridSize);
  const setGridSize = useEditor((s) => s.setGridSize);

  const active = snapEnabled || gridSnap;

  return (
    <div className="menu-root snap-menu-root">
      <Popover
        placement="top-end"
        className="snap-menu-popover"
        renderTrigger={({ ref, open, props }) => (
          <button
            ref={ref}
            className={`${barButton()} snap-menu-trigger${active ? " is-active" : ""}`}
            title="Snapping options"
            aria-label="Snapping options"
            aria-haspopup="menu"
            aria-expanded={open}
            {...props}
          >
            <LuMagnet aria-hidden />
            <span>Snap</span>
            <LuChevronDown className="menu-caret" aria-hidden />
          </button>
        )}
      >
        {() => (
          <>
            <label className="snap-menu-row">
              <input type="checkbox" checked={snapEnabled} onChange={toggleSnap} />
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
            <label className="snap-menu-row">
              <input
                type="checkbox"
                checked={gridVisible}
                onChange={toggleGridVisible}
              />
              Show grid
            </label>
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
          </>
        )}
      </Popover>
    </div>
  );
}
