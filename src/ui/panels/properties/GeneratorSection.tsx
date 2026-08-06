import { useEffect } from "react";
import {
  GENERATORS,
  resolveGenerator,
  UNTRUSTED_ERROR,
} from "@/model/generators/generators";
import type { PathShape } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import { useUi } from "../../../store/uiStore";
import { canBindGeneratorArgs, generatorArgPath } from "@/model/params";
import BindableNumber from "@/ui/controls/BindableNumber";
import Section from "../Section";

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
  const openGenerators = useUi((state) => state.openGenerators);

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
  // Built-in sources are shown read-only by the dialog; document scripts open
  // in the editor. Both jump through the same focus id.
  const isBuiltin = gen.scriptId in GENERATORS;

  return (
    <Section title={def.name}>
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
              <BindableNumber
                nodeId={shape.id}
                path={generatorArgPath(param.key)}
                label={param.label}
                min={param.min}
                max={param.max}
                step={param.step}
                value={gen.args[param.key] ?? param.default}
                defaultValue={param.default}
                bindDisabled={
                  canBindGeneratorArgs(gen.scriptId)
                    ? undefined
                    : "Script generators cannot be parameter-bound yet"
                }
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

      <div className="btn-row">
        <button
          className="ghost-btn"
          onClick={() => openGenerators(gen.scriptId)}
          title={
            isBuiltin
              ? "Show this generator's source in the Generators dialog"
              : "Edit this generator's source in the Generators dialog"
          }
        >
          {isBuiltin ? "View source" : "Edit source"}
        </button>
        <button className="ghost-btn" onClick={() => detachGenerator(shape.id)}>
          Detach (make editable)
        </button>
      </div>
    </Section>
  );
}
