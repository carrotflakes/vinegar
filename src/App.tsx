import { useEffect, useRef, useState } from "react";
import { LuCommand, LuMinus, LuPanelRight, LuPlus, LuRedo2, LuUndo2 } from "react-icons/lu";
import "./App.css";
import CanvasView from "./canvas/CanvasView";
import {
  commandEnabled,
  matchKeydown,
  placeImagesFitted,
  runCommand,
} from "./commands/registry";
import { imageFilesFromData } from "./io/importImage";
import {
  clearDocumentRecovery,
  startDocumentAutosave,
} from "./io/recovery";
import { scopeLeafIds } from "./model/scene";
import { currentSymbolScope, hasUnsavedChanges, useEditor, type ToolId } from "./store/editorStore";
import { usePointer } from "./store/pointerStore";
import { usePreferences } from "./store/preferencesStore";
import { useRecoveryStatus } from "./store/recoveryStore";
import { useUi } from "./store/uiStore";
import { barButton } from "./ui/AppBar.css";
import CommandPalette from "./ui/CommandPalette";
import ContextMenuHost from "./ui/ContextMenu";
import FileMenu from "./ui/FileMenu";
import FullscreenButton from "./ui/FullscreenButton";
import RightSidebar from "./ui/RightSidebar";
import SnapMenu from "./ui/SnapMenu";
import Toolbar from "./ui/Toolbar";
import ZoomMenu from "./ui/ZoomMenu";
import ExportDialog from "./ui/dialogs/ExportDialog";
import Inspector from "./ui/dialogs/Inspector";
import PreferencesDialog from "./ui/dialogs/PreferencesDialog";
import ScriptPanel from "./ui/dialogs/ScriptPanel";
import { usePreventBrowserZoom } from "./ui/usePreventBrowserZoom";

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
  compoundPath: "Compound Path",
  text: "Text",
  instance: "Instance",
  group: "Group",
};

/** Selection summary: count, or type + name for a single selection. */
function SelectionInfo() {
  const label = useEditor((s) => {
    const total = scopeLeafIds(s.doc, currentSymbolScope(s)).length;
    const n = s.selection.length;
    if (n === 1) {
      const node = s.doc.nodes[s.selection[0]];
      if (node) return `${TYPE_LABELS[node.type] ?? node.type} · ${node.name}`;
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
  brush: "Draw with pen pressure · adjust size / pressure / smoothing / taper in the panel",
  eraser: "Drag across brush strokes to split/trim them · size in the panel",
  text: "Click for auto width · drag for a wrapping area · double-click text to edit",
  artboard: "Drag to create a board · drag a board to move · drag handles to resize",
};

/** Per-tool usage hint for the status bar. */
function ToolHint() {
  const tool = useEditor((s) => s.tool);
  return <span className="status-hint">{TOOL_HINTS[tool]}</span>;
}

function recoveryTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

// Wording is intentionally "back up", not "save" — this is the local recovery
// snapshot, distinct from File ▸ Save. A leading state dot carries the colour so
// the label itself stays quiet.
const AUTOSAVE_LABEL: Record<string, string> = {
  ready: "Autosave on",
  saving: "Backing up…",
  saved: "Backed up",
  recovered: "Recovered",
  error: "Autosave failed",
};

const AUTOSAVE_TITLE: Record<string, string> = {
  ready: "Changes are backed up to this browser automatically",
  saving: "Backing up your changes to this browser…",
  saved: "Your work is backed up in this browser (not the .json file)",
  recovered: "Restored unsaved work from a previous session",
  error: "Autosave to this browser failed",
};

/** Browser recovery status; deliberately distinct from manual file saving. */
function AutosaveInfo() {
  const status = useRecoveryStatus((s) => s.status);
  const enabled = usePreferences((s) => s.recovery.enabled);
  const time = recoveryTime(status.at);
  const showTime = status.phase === "saved" || status.phase === "recovered";
  if (!enabled && status.phase !== "error") {
    return (
      <span className="autosave ready" title="Browser recovery snapshots are disabled">
        <span className="autosave-dot" aria-hidden />
        <span className="autosave-label">Autosave off</span>
      </span>
    );
  }
  return (
    <span
      className={`autosave ${status.phase}`}
      title={status.error ?? AUTOSAVE_TITLE[status.phase]}
      role={status.phase === "error" ? "alert" : undefined}
    >
      <span className="autosave-dot" aria-hidden />
      <span className="autosave-label">{AUTOSAVE_LABEL[status.phase]}</span>
      {showTime && time && <span className="autosave-time">{time}</span>}
    </span>
  );
}

export default function App() {
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const recoveryEnabled = usePreferences((s) => s.recovery.enabled);
  const recoveryMaxWaitMs = usePreferences((s) => s.recovery.maxWaitMs);
  const previousRecoveryEnabled = useRef(recoveryEnabled);
  const showPreferences = useUi((s) => s.preferencesOpen);
  const openPreferences = useUi((s) => s.openPreferences);
  const closePreferences = useUi((s) => s.closePreferences);
  const showExport = useUi((s) => s.exportOpen);
  const closeExport = useUi((s) => s.closeExport);
  const [showScript, setShowScript] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [showPalette, setShowPalette] = useState(false);

  usePreventBrowserZoom();

  useEffect(() => {
    if (!recoveryEnabled) return;
    const autosave = startDocumentAutosave({ maxWaitMs: recoveryMaxWaitMs });
    return () => autosave.stop();
  }, [recoveryEnabled, recoveryMaxWaitMs]);

  useEffect(() => {
    if (previousRecoveryEnabled.current && !recoveryEnabled) {
      void clearDocumentRecovery();
    }
    previousRecoveryEnabled.current = recoveryEnabled;
  }, [recoveryEnabled]);

  // Global keyboard shortcuts — dispatched through the command registry so the
  // bindings stay in sync with the menus and palette. Escape stays bespoke: it
  // is contextual (clear selection, then leave symbol edit) and coupled to the
  // active tool's modes rather than a single command.
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

      if (mod && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "p")) {
        e.preventDefault();
        setShowPalette(true);
        return;
      }
      if (e.key === "Escape") {
        if (s.selection.length || s.editNode) s.clearSelection();
        else if (s.activeGroupId) s.exitGroup();
        else if (s.editingSymbols.length) s.exitSymbolEdit();
        return;
      }

      const match = matchKeydown(e);
      if (match) {
        // Paste runs off the native `paste` event instead so it can read
        // system-clipboard images; let ⌘V through (don't preventDefault) so
        // that event fires. The paste listener below also does the vector paste.
        if (match.cmd.id === "edit.paste") return;
        // Swallow the browser default for any modifier chord (e.g. ⌘D bookmark)
        // and for command keys we actually act on.
        const enabled = commandEnabled(match.cmd, s);
        if (match.stroke.mod || enabled) e.preventDefault();
        if (enabled) runCommand(match.cmd.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Paste: system-clipboard images land as image nodes; otherwise fall back to
  // the in-memory vector clipboard. Skipped while typing so field pastes work.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const images = imageFilesFromData(e.clipboardData);
      if (images.length) {
        e.preventDefault();
        void placeImagesFitted(images);
        return;
      }
      const s = useEditor.getState();
      if (s.clipboard) {
        e.preventDefault();
        s.paste();
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Warn before leaving (close / reload / navigate away) with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useEditor.getState();
      if (!hasUnsavedChanges(s)) return;
      e.preventDefault();
      // Legacy browsers require a returnValue to trigger the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <div className="app">
      <header className="appbar">
        {/* Left zone — identity + menus. */}
        <div className="appbar-zone">
          <div className="brand">
            <img className="brand-mark" src="/logo.svg" alt="Vinegar logo" />
            <span className="brand-word">Vinegar</span>
          </div>
          <span className="appbar-sep" />
          <FileMenu onOpenPreferences={openPreferences} />
          <button className={barButton()} onClick={() => setShowScript(true)}>
            Script
          </button>
          <button className={barButton()} onClick={() => setShowInspector(true)}>
            Inspect
          </button>
        </div>

        {/* Center zone — reserved for contextual controls / document name. */}
        <div className="appbar-spacer" />

        {/* Right zone — history · view · global. */}
        <div className="appbar-zone">
          <button
            className={barButton({ icon: true })}
            disabled={!canUndo}
            onClick={() => runCommand("edit.undo")}
            title="Undo (Ctrl+Z)"
          >
            <LuUndo2 aria-hidden />
          </button>
          <button
            className={barButton({ icon: true })}
            disabled={!canRedo}
            onClick={() => runCommand("edit.redo")}
            title="Redo (Ctrl+Shift+Z)"
          >
            <LuRedo2 aria-hidden />
          </button>
          <span className="appbar-sep" />
          <button
            className={barButton({ icon: true })}
            onClick={() => runCommand("view.zoomOut")}
            title="Zoom out"
          >
            <LuMinus aria-hidden />
          </button>
          <ZoomMenu />
          <button
            className={barButton({ icon: true })}
            onClick={() => runCommand("view.zoomIn")}
            title="Zoom in"
          >
            <LuPlus aria-hidden />
          </button>
          <span className="appbar-sep" />
          <button
            className={barButton({ icon: true })}
            onClick={() => setShowPalette(true)}
            title="Command palette (Ctrl+K)"
          >
            <LuCommand aria-hidden />
          </button>
          <FullscreenButton />
          <button
            className={barButton({ icon: true, panelToggle: true })}
            onClick={() => setShowPanel((v) => !v)}
            aria-pressed={showPanel}
            title="Toggle panel"
          >
            <LuPanelRight aria-hidden />
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
        {showPanel && (
          <div
            className="panel-backdrop"
            onClick={() => setShowPanel(false)}
          />
        )}
        <RightSidebar open={showPanel} />
      </div>

      <ScriptPanel open={showScript} onClose={() => setShowScript(false)} />
      <Inspector open={showInspector} onClose={() => setShowInspector(false)} />
      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} />
      <PreferencesDialog open={showPreferences} onClose={closePreferences} />
      <ExportDialog open={showExport} onClose={closeExport} />
      <ContextMenuHost />

      <footer className="statusbar">
        <PointerReadout />
        <span className="dot status-hint">·</span>
        <SelectionInfo />
        <span className="dot status-hint">·</span>
        <ToolHint />
        <span className="status-spacer" />
        <AutosaveInfo />
        <span className="status-sep" />
        <SnapMenu />
      </footer>
    </div>
  );
}
