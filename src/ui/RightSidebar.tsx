import { useCallback, useEffect, useRef, useState } from "react";
import Dock from "./dock/Dock";
import { DEFAULT_DOCK_WIDTH, useDock } from "./dock/dockStore";
import "./RightSidebar.css";

/**
 * Right sidebar. The contents are a tabbed dock (see `dock/Dock`): a column of
 * tab groups whose panels stack as tabs, so the sidebar's width stays fixed no
 * matter how many panels are open. The wrapper handles show/hide and lets the
 * user drag its left edge to resize (width lives in the dock store so "Reset
 * layout" restores it too; the drag exposes width as the `--dock-w` custom
 * property so the narrow-screen overlay can ignore it).
 */
export default function RightSidebar({ open = false }: { open?: boolean }) {
  const width = useDock((s) => s.width);
  const setWidth = useDock((s) => s.setWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      // The handle sits on the sidebar's left edge, so dragging left widens it.
      setWidth(d.startW - (event.clientX - d.startX));
    },
    [setWidth]
  );

  const endDrag = useCallback(() => {
    drag.current = null;
    setDragging(false);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onPointerMove]);

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    drag.current = { startX: event.clientX, startW: width };
    setDragging(true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => endDrag, [endDrag]);

  return (
    <div
      className={"right" + (open ? " open" : "")}
      style={{ "--dock-w": `${width}px` } as React.CSSProperties}
    >
      <div
        className={"right-resize" + (dragging ? " dragging" : "")}
        onPointerDown={startDrag}
        onDoubleClick={() => setWidth(DEFAULT_DOCK_WIDTH)}
        title="Drag to resize · double-click to reset"
      />
      <Dock />
    </div>
  );
}
