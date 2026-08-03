import { paintValue, type SymbolInstance, type SymbolParam } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ColorField from "@/ui/controls/ColorField";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import { BlendModeField, OpacityField } from "./StyleFields";
import Section from "../Section";

/**
 * One overridable parameter of the placed symbol. The row edits the instance's
 * own value over the definition's default; clearing it falls back to the
 * default rather than baking it in. A numeric override retunes the geometry
 * this instance draws — the definition's stored numbers stay the defaults and
 * the per-instance reading is derived (docs/parameters.md, phase 2b).
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
  const label = overridden ? `${param.label} (overridden)` : param.label;

  const reset = overridden && (
    <div className="btn-row">
      <button
        className="ghost-btn"
        onClick={() => setInstanceArg(instance.id, param.key, null)}
      >
        Reset “{param.label}”
      </button>
    </div>
  );

  if (value.kind === "number") {
    // The scrubber hints stay the definition's — an override retunes the
    // number, it does not redefine the parameter.
    const hints = param.default.kind === "number" ? param.default : value;
    return (
      <>
        <div className="field-inline">
          <label>{label}</label>
          <ScrubbableNumber
            className="num"
            value={value.value}
            aria-label={param.label}
            {...(hints.min !== null ? { min: hints.min } : {})}
            {...(hints.max !== null ? { max: hints.max } : {})}
            {...(hints.step !== null ? { step: hints.step } : {})}
            defaultValue={hints.value}
            onChange={(next) =>
              setInstanceArg(instance.id, param.key, {
                ...hints,
                value: hints.integer ? Math.round(next) : next,
              })
            }
          />
        </div>
        {reset}
      </>
    );
  }
  return (
    <>
      <ColorField
        label={label}
        value={value.value}
        onChange={(paint) =>
          paint && paint.type !== "var" &&
          setInstanceArg(instance.id, param.key, paintValue(paint))
        }
      />
      {reset}
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
