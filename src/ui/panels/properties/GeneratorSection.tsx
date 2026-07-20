import { useEffect } from "react";
import {
  GENERATORS,
  resolveGenerator,
  UNTRUSTED_ERROR,
} from "../../../model/generators";
import type { PathShape } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ScrubbableNumber from "../../ScrubbableNumber";

/**
 * Parameter controls for a parametric node. Editing a value regenerates the
 * geometry from the generator; "Detach" drops the link for free-form editing.
 * Document-script params come from the worker-compiled `scriptMeta`, so this
 * shows a brief "Compiling…" state and never runs user code on the main thread.
 */
export default function GeneratorSection({ shape }: { shape: PathShape }) {
  const setGeneratorArgs = useEditor((state) => state.setGeneratorArgs);
  const detachGenerator = useEditor((state) => state.detachGenerator);
  const trustScripts = useEditor((state) => state.trustScripts);
  const ensureScriptCompiled = useEditor((state) => state.ensureScriptCompiled);
  const scripts = useEditor((state) => state.doc.scripts);
  const scriptMeta = useEditor((state) => state.scriptMeta);
  const trusted = useEditor((state) => state.scriptsTrusted);

  const gen = shape.generator;
  const scriptId = gen?.scriptId;
  const source = scriptId ? scripts[scriptId]?.source : undefined;
  // Compile the referenced document script (idempotent) whenever its source
  // changes or the document becomes trusted.
  useEffect(() => {
    if (scriptId && trusted && !(scriptId in GENERATORS)) {
      ensureScriptCompiled(scriptId);
    }
  }, [scriptId, source, trusted, ensureScriptCompiled]);

  const def = gen ? resolveGenerator(gen.scriptId, scripts, trusted, scriptMeta) : null;
  if (!gen || !def) return null;

  return (
    <div className="panel-section">
      <div className="panel-title">{def.name}</div>

      {def.status === "untrusted" ? (
        <>
          <div className="script-status err">{UNTRUSTED_ERROR}</div>
          <button className="ghost-btn" onClick={trustScripts}>
            Enable generators for this document
          </button>
        </>
      ) : (
        <>
          {def.status === "compiling" && (
            <div className="script-status">Compiling…</div>
          )}
          {def.status === "error" && def.error && (
            <div className="script-status err">{def.error}</div>
          )}
          {def.params.map((param) => (
            <div className="field" key={param.key}>
              <label>{param.label}</label>
              <ScrubbableNumber
                className="num"
                min={param.min}
                max={param.max}
                step={param.step}
                value={gen.args[param.key] ?? param.default}
                aria-label={param.label}
                onChange={(value) =>
                  setGeneratorArgs(shape.id, {
                    [param.key]: param.integer ? Math.round(value) : value,
                  })
                }
              />
            </div>
          ))}
        </>
      )}

      <button className="ghost-btn" onClick={() => detachGenerator(shape.id)}>
        Detach (make editable)
      </button>
    </div>
  );
}
