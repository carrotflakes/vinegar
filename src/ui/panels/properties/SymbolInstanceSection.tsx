import type { SymbolInstance } from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import { BlendModeField, OpacityField } from "./StyleFields";

export default function SymbolInstanceSection({
  instance,
  symbolName,
}: {
  instance: SymbolInstance;
  symbolName: string;
}) {
  const enterSymbolEdit = useEditor((state) => state.enterSymbolEdit);
  const detachSelectedInstances = useEditor(
    (state) => state.detachSelectedInstances
  );
  const updateNodeStyle = useEditor((state) => state.updateNodeStyle);

  return (
    <div className="panel-section">
      <div className="panel-title">Symbol instance</div>
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
          onClick={() => enterSymbolEdit(instance.symbolId)}
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
    </div>
  );
}
