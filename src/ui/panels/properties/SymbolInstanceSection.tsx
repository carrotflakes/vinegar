import { paintValue, type SymbolInstance, type SymbolParam } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ColorField from "@/ui/controls/ColorField";
import { BlendModeField, OpacityField } from "./StyleFields";
import Section from "../Section";

/**
 * One overridable parameter of the placed symbol. The row edits the instance's
 * own value over the definition's default; clearing it falls back to the
 * default rather than baking it in. Numeric parameters are declarable but not
 * yet honoured — a bound number resolves at commit time, one value per node —
 * so their rows are visible and disabled until phase 2b. See docs/parameters.md.
 */
function InstanceParamRow({
  instance,
  param,
}: {
  instance: SymbolInstance;
  param: SymbolParam;
}) {
  const setInstanceArg = useEditor((state) => state.setInstanceArg);
  const arg = instance.args[param.key];
  const value = arg && arg.kind === param.default.kind ? arg : param.default;
  const overridden = !!arg;

  if (value.kind === "number") {
    return (
      <div className="field-inline">
        <label>{param.label}</label>
        <span
          className="readout"
          title="Numeric symbol parameters are not overridable yet"
        >
          {value.value}
        </span>
      </div>
    );
  }
  return (
    <>
      <ColorField
        label={overridden ? `${param.label} (overridden)` : param.label}
        value={value.value}
        onChange={(paint) =>
          paint && paint.type !== "var" &&
          setInstanceArg(instance.id, param.key, paintValue(paint))
        }
      />
      {overridden && (
        <div className="btn-row">
          <button
            className="ghost-btn"
            onClick={() => setInstanceArg(instance.id, param.key, null)}
          >
            Reset “{param.label}”
          </button>
        </div>
      )}
    </>
  );
}

export default function SymbolInstanceSection({
  instance,
  symbolName,
}: {
  instance: SymbolInstance;
  symbolName: string;
}) {
  const enterSymbolInstance = useEditor((state) => state.enterSymbolInstance);
  const detachSelectedInstances = useEditor(
    (state) => state.detachSelectedInstances
  );
  const updateNodeStyle = useEditor((state) => state.updateNodeStyle);
  const params = useEditor(
    (state) => state.doc.symbols[instance.symbolId]?.params
  );

  return (
    <Section title="Symbol">
      <div className="field">
        <label>Symbol</label>
        <div className="field-row">
          <span className="readout instance-symbol-name">
            {symbolName}
          </span>
        </div>
      </div>
      {(params ?? []).map((param) => (
        <InstanceParamRow key={param.key} instance={instance} param={param} />
      ))}
      <OpacityField
        label="Opacity"
        value={instance.opacity}
        onChange={(value) =>
          updateNodeStyle(instance.id, { opacity: value })
        }
      />
      <BlendModeField
        label="Blend mode"
        value={instance.blendMode}
        onChange={(value) =>
          updateNodeStyle(instance.id, { blendMode: value })
        }
      />
      <div className="btn-row">
        <button
          className="ghost-btn"
          onClick={() => enterSymbolInstance(instance.id)}
        >
          Edit symbol
        </button>
        <button
          className="ghost-btn"
          onClick={detachSelectedInstances}
        >
          Detach
        </button>
      </div>
    </Section>
  );
}
