import type { SymbolInstance } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import { BlendModeField, OpacityField } from "./StyleFields";
import Section from "../Section";

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

  return (
    <Section id="properties.symbol" title="Symbol">
      <div className="field">
        <label>Symbol</label>
        <div className="field-row">
          <span className="readout instance-symbol-name">
            {symbolName}
          </span>
        </div>
      </div>
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
