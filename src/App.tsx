import { useEffect, useState } from "react";
import CanvasView from "./canvas/CanvasView";
import { initialViewport, zoomAt } from "./model/viewport";
import { useEditor, type ToolId } from "./store/editorStore";
import { usePointer } from "./store/pointerStore";
import Toolbar from "./ui/Toolbar";
import RightSidebar from "./ui/RightSidebar";
import FileMenu from "./ui/FileMenu";
import ScriptPanel from "./ui/ScriptPanel";
import ContextMenuHost from "./ui/ContextMenu";
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

/**
 * Live pointer position in world coordinates. While an interaction is in
 * progress it shows the interaction readout instead (W×H, ΔX/ΔY, angle…).
 */
function PointerReadout() {
  const pos = usePointer((s) => s.pos);
  const readout = usePointer((s) => s.readout);
  return (
    <span className={readout ? "pointer-readout live" : "pointer-readout"}>
      {readout ?? (pos ? `${Math.round(pos.x)}, ${Math.round(pos.y)}` : "")}
    </span>
  );
}

const TYPE_LABELS: Record<string, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  path: "Path",
  bezier: "Curve",
  polygon: "Polygon",
};

/** Selection summary: count, or type + name for a single selection. */
function SelectionInfo() {
  const label = useEditor((s) => {
    const total = s.doc.order.length;
    const n = s.selection.length;
    if (n === 1) {
      const shape = s.doc.shapes[s.selection[0]];
      if (shape) return `${TYPE_LABELS[shape.type] ?? shape.type} · ${shape.name}`;
    }
    if (n > 1) return `${n} of ${total} selected`;
    return `${total} shape${total === 1 ? "" : "s"}`;
  });
  return <span>{label}</span>;
}

const TOOL_HINTS: Record<ToolId, string> = {
  select:
    "Shift+click to add · Space+drag to pan · Ctrl/⌘+wheel to zoom",
  node: "Click path to add a point · double-click a point: smooth ↔ corner · Alt breaks symmetry",
  rect: "Shift = square · Alt = from center",
  ellipse: "Shift = circle · Alt = from center",
  line: "Shift = 45°",
  pen: "Click/drag to add · click start to close · click an open end to continue · Shift = 45° · Enter finish · Esc cancel",
  pencil: "Drag to draw · end near start to close",
};

/** Per-tool usage hint for the status bar. */
function ToolHint() {
  const tool = useEditor((s) => s.tool);
  return <span className="status-hint">{TOOL_HINTS[tool]}</span>;
}

function canvasCenter(): { x: number; y: number } {
  const el = document.querySelector(".canvas-wrap");
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.width / 2, y: r.height / 2 };
}

export default function App() {
  const viewport = useEditor((s) => s.viewport);
  const setViewport = useEditor((s) => s.setViewport);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const gridSnap = useEditor((s) => s.gridSnap);
  const toggleGridSnap = useEditor((s) => s.toggleGridSnap);
  const gridSize = useEditor((s) => s.gridSize);
  const setGridSize = useEditor((s) => s.setGridSize);
  const [showScript, setShowScript] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

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
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        s.selectAll();
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
          <span className="brand-mark">▰</span>
          <span className="brand-word">Vinegar</span>
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
        <button
          className="ghost-btn panel-toggle"
          onClick={() => setShowPanel((v) => !v)}
          aria-pressed={showPanel}
          title="Toggle panel"
        >
          Panel
        </button>
      </header>

      <div className="body">
        <aside className="left">
          <Toolbar />
        </aside>
        <main className="stage">
          <CanvasView />
        </main>
        {showPanel && (
          <div
            className="panel-backdrop"
            onClick={() => setShowPanel(false)}
          />
        )}
        <RightSidebar open={showPanel} />
      </div>

      <ScriptPanel open={showScript} onClose={() => setShowScript(false)} />
      <ContextMenuHost />

      <footer className="statusbar">
        <PointerReadout />
        <span className="dot status-hint">·</span>
        <SelectionInfo />
        <span className="dot status-hint">·</span>
        <ToolHint />
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
        <label className="snap-toggle">
          Size
          <input
            type="number"
            min={1}
            step={1}
            value={gridSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 1) setGridSize(v);
            }}
            className="grid-size-input"
          />
        </label>
      </footer>
    </div>
  );
}
