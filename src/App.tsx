import { useEffect, useState } from "react";
import CanvasView from "./canvas/CanvasView";
import { initialViewport, zoomAt } from "./model/viewport";
import { useEditor, type ToolId } from "./store/editorStore";
import Toolbar from "./ui/Toolbar";
import RightSidebar from "./ui/RightSidebar";
import FileMenu from "./ui/FileMenu";
import ScriptPanel from "./ui/ScriptPanel";
import "./App.css";

const TOOL_KEYS: Record<string, ToolId> = {
  v: "select",
  n: "node",
  r: "rect",
  o: "ellipse",
  l: "line",
  p: "pen",
  b: "pencil",
};

function canvasCenter(): { x: number; y: number } {
  const el = document.querySelector(".canvas-wrap");
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.width / 2, y: r.height / 2 };
}

export default function App() {
  const viewport = useEditor((s) => s.viewport);
  const setViewport = useEditor((s) => s.setViewport);
  const shapeCount = useEditor((s) => s.doc.order.length);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const gridSnap = useEditor((s) => s.gridSnap);
  const toggleGridSnap = useEditor((s) => s.toggleGridSnap);
  const [showScript, setShowScript] = useState(false);

  // Global keyboard shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) s.ungroupSelected();
        else s.groupSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        s.copySelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        s.cutSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        s.paste();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        s.duplicateSelected();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (s.editNode) {
          e.preventDefault();
          s.deleteEditNode();
        } else if (s.selection.length > 0) {
          e.preventDefault();
          s.deleteSelected();
        }
        return;
      }
      if (e.key === "Escape") {
        s.clearSelection();
        return;
      }
      if (!mod && TOOL_KEYS[e.key.toLowerCase()]) {
        s.setTool(TOOL_KEYS[e.key.toLowerCase()]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const zoomBy = (factor: number) =>
    setViewport(zoomAt(viewport, canvasCenter(), factor));
  const resetView = () => setViewport(initialViewport);

  return (
    <div className="app">
      <header className="appbar">
        <div className="brand">
          <span className="brand-mark">▰</span> Vinegar
        </div>
        <FileMenu />
        <button className="ghost-btn" onClick={() => setShowScript(true)}>
          Script
        </button>
        <div className="appbar-group">
          <button
            className="ghost-btn"
            disabled={!canUndo}
            onClick={() => useEditor.getState().undo()}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            className="ghost-btn"
            disabled={!canRedo}
            onClick={() => useEditor.getState().redo()}
            title="Redo (Ctrl+Shift+Z)"
          >
            Redo
          </button>
        </div>
        <div className="appbar-spacer" />
        <div className="appbar-group">
          <button className="ghost-btn" onClick={() => zoomBy(1 / 1.2)}>
            −
          </button>
          <button
            className="ghost-btn zoom-readout"
            onClick={resetView}
            title="Reset view"
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <button className="ghost-btn" onClick={() => zoomBy(1.2)}>
            +
          </button>
        </div>
      </header>

      <div className="body">
        <aside className="left">
          <Toolbar />
        </aside>
        <main className="stage">
          <CanvasView />
        </main>
        <RightSidebar />
      </div>

      <ScriptPanel open={showScript} onClose={() => setShowScript(false)} />

      <footer className="statusbar">
        <span>{shapeCount} shapes</span>
        <span className="dot">·</span>
        <span>Space + drag to pan · Ctrl/⌘ + wheel to zoom</span>
        <span className="status-spacer" />
        <label className="snap-toggle">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={toggleSnap}
          />
          Snap
        </label>
        <label className="snap-toggle">
          <input
            type="checkbox"
            checked={gridSnap}
            onChange={toggleGridSnap}
          />
          Grid
        </label>
      </footer>
    </div>
  );
}
