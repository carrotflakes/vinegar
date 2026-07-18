import { useEffect, useRef, useState } from "react";
import { LuX } from "react-icons/lu";
import { canvasCenter } from "../../commands/registry";
import { buildGenerator, compileGenerator } from "../../model/generatorClient";
import { defaultArgs, GENERATORS } from "../../model/generators";
import type { BezierSubpath } from "../../model/types";
import { screenToWorld } from "../../model/viewport";
import { useEditor } from "../../store/editorStore";
import { drawGeometryPreview } from "./generatorPreview";
import "../Modal.css";
import "./ScriptPanel.css";
import "./GeneratorsDialog.css";

export const NEW_SCRIPT_SOURCE = `// Parametric generator — return { params, build }.
// params: numeric controls shown in the properties panel.
// build(args) -> subpaths: [{ anchors: [{ p:{x,y}, hIn, hOut }], closed }]
// Geometry is local space, centered on the origin. Runs on every edit.

const params = [
  { key: "sides", label: "Sides", min: 3, max: 12, step: 1, default: 6, integer: true },
  { key: "radius", label: "Radius", min: 1, max: 400, step: 1, default: 80 },
];

function build(args) {
  const anchors = [];
  for (let i = 0; i < args.sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / args.sides;
    anchors.push({
      p: { x: Math.cos(a) * args.radius, y: Math.sin(a) * args.radius },
      hIn: null,
      hOut: null,
    });
  }
  return [{ anchors, closed: true }];
}

return { params, build };
`;

interface Props {
  open: boolean;
  /** When opening, preselect and load this document script for editing. */
  focusId?: string | null;
  onClose: () => void;
}

/** A draft copy of the selected user script, edited before it is saved. */
interface Draft {
  name: string;
  source: string;
}

export default function GeneratorsDialog({ open, focusId, onClose }: Props) {
  const scripts = useEditor((s) => s.doc.scripts);
  const trusted = useEditor((s) => s.scriptsTrusted);
  const addScript = useEditor((s) => s.addScript);
  const updateScript = useEditor((s) => s.updateScript);
  const deleteScript = useEditor((s) => s.deleteScript);
  const insertGenerator = useEditor((s) => s.insertGenerator);
  const trustScripts = useEditor((s) => s.trustScripts);

  // Selected generator id (built-in or script). `draft` is present only when a
  // user script is selected, holding its editable name/source until saved.
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Live compile feedback for the draft, produced off the main thread (worker).
  const [draftError, setDraftError] = useState<string | undefined>(undefined);
  // Geometry drawn in the live preview (default args of the selected generator).
  const [preview, setPreview] = useState<BezierSubpath[] | null>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);

  // Preselect a script for editing when opened with a focus id (from the panel).
  useEffect(() => {
    if (!open || !focusId) return;
    const script = scripts[focusId];
    if (!script) return;
    setSelected(focusId);
    setDraft({ name: script.name, source: script.source });
    // Only react to a fresh open/focus, not to later edits of the script.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusId]);

  // Built-in preview: native + synchronous. (Scripts are handled below.)
  useEffect(() => {
    if (draft) return;
    if (selected && selected in GENERATORS) {
      const g = GENERATORS[selected];
      setPreview(g.build(defaultArgs(g)) ?? null);
    } else {
      setPreview(null);
    }
  }, [selected, draft]);

  // Draft preview + compile feedback: debounced, off the main thread.
  const draftSource = draft?.source;
  useEffect(() => {
    if (!trusted || draftSource === undefined) {
      setDraftError(undefined);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const compiled = await compileGenerator(draftSource);
      if (cancelled) return;
      setDraftError(compiled.error);
      if (compiled.error) {
        setPreview(null);
        return;
      }
      const { subpaths } = await buildGenerator(
        draftSource,
        defaultArgs({ params: compiled.params })
      );
      if (!cancelled) setPreview(subpaths ?? null);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trusted, draftSource]);

  // Redraw the preview whenever its geometry (or visibility) changes.
  useEffect(() => {
    if (open) drawGeometryPreview(previewCanvas.current, preview);
  }, [open, preview]);

  if (!open) return null;

  const builtins = Object.values(GENERATORS);

  const selectBuiltin = (id: string) => {
    setSelected(id);
    setDraft(null);
  };
  const selectScript = (id: string) => {
    const script = scripts[id];
    if (!script) return;
    setSelected(id);
    setDraft({ name: script.name, source: script.source });
  };
  const createScript = () => {
    const id = addScript("Untitled generator", NEW_SCRIPT_SOURCE);
    setSelected(id);
    setDraft({ name: "Untitled generator", source: NEW_SCRIPT_SOURCE });
  };

  const insert = async () => {
    if (!selected) return;
    // Persist pending edits first so the inserted node resolves live source.
    if (draft) updateScript(selected, draft);
    const { viewport } = useEditor.getState();
    // Document scripts build in a Worker; await so the node lands before closing.
    await insertGenerator(selected, screenToWorld(viewport, canvasCenter()));
    onClose();
  };

  const isBuiltin = selected !== null && selected in GENERATORS;
  const builtin = isBuiltin ? GENERATORS[selected] : null;
  const compileError = trusted ? draftError : undefined;
  // Inserting a document-script generator needs consent; built-ins always run.
  const insertBlocked = !selected || (!isBuiltin && !trusted);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal generators-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>Generators</span>
          <button
            className="modal-close"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <LuX aria-hidden />
          </button>
        </div>

        <div className="gen-list">
          {builtins.map((g) => (
            <button
              key={g.id}
              className={"gen-chip" + (selected === g.id ? " active" : "")}
              onClick={() => selectBuiltin(g.id)}
            >
              {g.name}
            </button>
          ))}
          {Object.values(scripts).map((s) => (
            <button
              key={s.id}
              className={"gen-chip" + (selected === s.id ? " active" : "")}
              onClick={() => selectScript(s.id)}
            >
              {s.name}
            </button>
          ))}
          <button className="gen-chip" onClick={createScript}>
            + New
          </button>
        </div>

        {!trusted && (
          <div className="gen-name-field">
            <div className="script-status err">
              This document’s generators are disabled until you enable them.
            </div>
            <button className="ghost-btn" onClick={trustScripts}>
              Enable generators for this document
            </button>
          </div>
        )}

        {selected && (
          <canvas ref={previewCanvas} className="gen-preview" aria-hidden />
        )}

        {draft ? (
          <>
            <div className="gen-name-field">
              <input
                value={draft.name}
                spellCheck={false}
                placeholder="Generator name"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <textarea
              className="script-editor"
              value={draft.source}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, source: e.target.value })}
            />
          </>
        ) : builtin ? (
          <textarea
            key={builtin.id}
            className="script-editor"
            value={builtin.source}
            aria-label={`${builtin.name} built-in generator source`}
            spellCheck={false}
            readOnly
          />
        ) : (
          <div className="gen-empty">
            Select a generator to insert, or create your own with “+ New”.
          </div>
        )}

        <div className="modal-foot">
          <span className={"script-status" + (compileError ? " err" : "")}>
            {compileError ??
              (draft
                ? "Edits apply on Save or Insert."
                : builtin
                  ? "Built-in generator source is read-only."
                  : "")}
          </span>
          {draft && (
            <button
              className="ghost-btn"
              onClick={() => {
                if (selected) deleteScript(selected);
                setSelected(null);
                setDraft(null);
              }}
            >
              Delete
            </button>
          )}
          {draft && (
            <button
              className="ghost-btn"
              onClick={() => selected && updateScript(selected, draft)}
            >
              Save
            </button>
          )}
          <button
            className="modal-primary-btn"
            onClick={insert}
            disabled={insertBlocked}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
