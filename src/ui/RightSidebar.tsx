import { useEffect, useRef, useState } from "react";
import LayersPanel from "./LayersPanel";
import PropertiesPanel from "./PropertiesPanel";

const STORAGE_KEY = "vinegar.propsHeight";
const MIN_PANE = 120;
const DIVIDER = 7;

/**
 * Right sidebar with a draggable divider between Properties (top) and Layers
 * (bottom). The split height is user-controlled and persisted, so the panes
 * never resize themselves when the selection changes.
 */
export default function RightSidebar() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const [propsHeight, setPropsHeight] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved > 0 ? saved : 320;
  });

  const clamp = (h: number) => {
    const total = wrapRef.current?.clientHeight ?? 800;
    return Math.max(MIN_PANE, Math.min(total - MIN_PANE - DIVIDER, h));
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(propsHeight));
  }, [propsHeight]);

  // Keep the split valid when the window (sidebar) is resized.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setPropsHeight((h) => clamp(h)));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: propsHeight };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPropsHeight(clamp(d.startH + (e.clientY - d.startY)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="right" ref={wrapRef}>
      <div className="props-pane" style={{ height: propsHeight }}>
        <PropertiesPanel />
      </div>
      <div
        className="pane-divider"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Drag to resize"
      />
      <div className="layers-pane">
        <LayersPanel />
      </div>
    </div>
  );
}
