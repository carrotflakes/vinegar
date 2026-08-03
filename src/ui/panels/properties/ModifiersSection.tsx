import { LuChevronDown, LuChevronUp, LuCrosshair, LuTriangleAlert, LuX } from "react-icons/lu";
import { BOOL_OPS, type BoolOp, type PathModifier, type PathShape } from "@/model/types";
import { useEditor } from "@/store/editorStore";
import { booleanOperandError } from "@/model/path/pathModifiers";
import { modifierParamPath, remapModifierBindings } from "@/model/params";
import BindableNumber from "@/ui/controls/BindableNumber";
import Section from "../Section";

function modifierLabel(type: PathModifier["type"]): string {
  switch (type) {
    case "simplify": return "Simplify";
    case "flatten": return "Flatten";
    case "offset": return "Offset";
    case "outline": return "Outline";
    case "smooth": return "Smooth";
    case "reverse": return "Reverse";
    case "boolean": return "Boolean";
  }
}

const BOOL_OP_LABEL: Record<BoolOp, string> = {
  union: "Unite",
  subtract: "Subtract",
  intersect: "Intersect",
  xor: "Exclude",
};

export default function ModifiersSection({ shape }: { shape: PathShape }) {
  const doc = useEditor((state) => state.doc);
  const setPathModifiers = useEditor((state) => state.setPathModifiers);
  const setModifierOperand = useEditor((state) => state.setModifierOperand);
  const beginOperandPick = useEditor((state) => state.beginOperandPick);
  const operandPick = useEditor((state) => state.operandPick);
  const addPathModifierSelected = useEditor((state) => state.addPathModifierSelected);
  const applyPathModifiersSelected = useEditor((state) => state.applyPathModifiersSelected);
  const modifiers = shape.modifiers ?? [];

  const replace = (index: number, next: PathModifier) =>
    setPathModifiers(
      shape.id,
      modifiers.map((modifier, modifierIndex) =>
        modifierIndex === index ? next : modifier
      )
    );
  // Bindings are keyed by stack index, so removing or moving a stage has to
  // carry them along or they would stay pointing at the slot instead of the
  // modifier the user bound. `replace` never moves anything, so it does not.
  const remove = (index: number) => {
    const moved = new Map<number, number>();
    modifiers.forEach((_, i) => {
      if (i < index) moved.set(i, i);
      else if (i > index) moved.set(i, i - 1);
    });
    setPathModifiers(
      shape.id,
      modifiers.filter((_, modifierIndex) => modifierIndex !== index),
      remapModifierBindings(shape.bindings, moved)
    );
  };
  const move = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= modifiers.length) return;
    const next = [...modifiers];
    [next[index], next[destination]] = [next[destination], next[index]];
    const moved = new Map(modifiers.map((_, i) => [i, i]));
    moved.set(index, destination);
    moved.set(destination, index);
    setPathModifiers(shape.id, next, remapModifierBindings(shape.bindings, moved));
  };
  const numberField = (
    index: number,
    key: string,
    label: string,
    value: number,
    onChange: (value: number) => void,
    min?: number
  ) => (
    <label className="geo-field">
      <span>{label}</span>
      <BindableNumber
        nodeId={shape.id}
        path={modifierParamPath(index, key)}
        label={label}
        value={Math.round(value * 100) / 100}
        min={min}
        step={0.1}
        onChange={onChange}
      />
    </label>
  );

  return (
    <Section title="Modifiers">
      {modifiers.map((modifier, index) => (
        <div className="effect-card" key={index}>
          <div className="field-row effect-head">
            <input
              type="checkbox"
              checked={modifier.enabled !== false}
              title={modifier.enabled === false ? "Enable" : "Disable"}
              aria-label={`${modifierLabel(modifier.type)} enabled`}
              onChange={() => replace(index, {
                ...modifier,
                enabled: modifier.enabled === false,
              })}
            />
            <span className="effect-name">{modifierLabel(modifier.type)}</span>
            <button
              className="ghost-btn icon-btn"
              title="Move up"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <LuChevronUp aria-hidden />
            </button>
            <button
              className="ghost-btn icon-btn"
              title="Move down"
              disabled={index === modifiers.length - 1}
              onClick={() => move(index, 1)}
            >
              <LuChevronDown aria-hidden />
            </button>
            <button
              className="ghost-btn icon-btn danger"
              title="Remove"
              onClick={() => remove(index)}
            >
              <LuX aria-hidden />
            </button>
          </div>
          {modifier.type === "simplify" || modifier.type === "flatten" ? (
            <div className="geometry-grid">
              {numberField(index, "tolerance", "Tolerance", modifier.tolerance, (value) =>
                replace(index, { ...modifier, tolerance: Math.max(0, value) }), 0
              )}
            </div>
          ) : modifier.type === "offset" ? (
            <>
              <div className="geometry-grid">
                {numberField(index, "distance", "Distance", modifier.distance, (value) =>
                  replace(index, { ...modifier, distance: value })
                )}
              </div>
              <label className="field-inline">
                <span>Join</span>
                <select
                  className="blend-select"
                  value={modifier.join}
                  onChange={(event) => replace(index, {
                    ...modifier,
                    join: event.target.value as typeof modifier.join,
                  })}
                >
                  <option value="miter">Miter</option>
                  <option value="round">Round</option>
                  <option value="bevel">Bevel</option>
                </select>
              </label>
            </>
          ) : modifier.type === "boolean" ? (
            <>
              <label className="field-inline">
                <span>Operation</span>
                <select
                  className="blend-select"
                  value={modifier.op}
                  onChange={(event) => replace(index, {
                    ...modifier,
                    op: event.target.value as BoolOp,
                  })}
                >
                  {BOOL_OPS.map((op) => (
                    <option key={op} value={op}>{BOOL_OP_LABEL[op]}</option>
                  ))}
                </select>
              </label>
              <label className="field-inline">
                <span>With</span>
                <div className="field-row">
                  <span className="readout">
                    {doc.nodes[modifier.operandId]?.name ?? "None"}
                  </span>
                  {/* Picking is a canvas act: the operand is a shape, and the
                      canvas is where shapes are identified. */}
                  <button
                    className={
                      "ghost-btn icon-btn" +
                      (operandPick?.nodeId === shape.id && operandPick.index === index
                        ? " active"
                        : "")
                    }
                    title="Pick the other shape on the canvas"
                    onClick={() =>
                      beginOperandPick(
                        operandPick?.nodeId === shape.id && operandPick.index === index
                          ? null
                          : { nodeId: shape.id, index }
                      )
                    }
                  >
                    <LuCrosshair aria-hidden />
                  </button>
                  <button
                    className="ghost-btn icon-btn"
                    title="Clear the other shape"
                    disabled={!modifier.operandId}
                    onClick={() => setModifierOperand(shape.id, index, null)}
                  >
                    <LuX aria-hidden />
                  </button>
                </div>
              </label>
              {booleanOperandError(shape, index, doc) && (
                <div className="modifier-error">
                  <LuTriangleAlert aria-hidden />
                  <span>{booleanOperandError(shape, index, doc)}</span>
                </div>
              )}
            </>
          ) : modifier.type === "outline" ? (
            <>
              <div className="geometry-grid">
                {numberField(index, "width", "Width", modifier.width, (value) =>
                  replace(index, { ...modifier, width: Math.max(0, value) }), 0
                )}
              </div>
              <label className="field-inline">
                <span>Cap</span>
                <select
                  className="blend-select"
                  value={modifier.cap}
                  onChange={(event) => replace(index, {
                    ...modifier,
                    cap: event.target.value as typeof modifier.cap,
                  })}
                >
                  <option value="butt">Butt</option>
                  <option value="round">Round</option>
                  <option value="square">Square</option>
                </select>
              </label>
              <label className="field-inline">
                <span>Join</span>
                <select
                  className="blend-select"
                  value={modifier.join}
                  onChange={(event) => replace(index, {
                    ...modifier,
                    join: event.target.value as typeof modifier.join,
                  })}
                >
                  <option value="miter">Miter</option>
                  <option value="round">Round</option>
                  <option value="bevel">Bevel</option>
                </select>
              </label>
            </>
          ) : null}
        </div>
      ))}
      <div className="field">
        <select
          className="blend-select"
          value=""
          onChange={(event) => {
            if (event.target.value) {
              addPathModifierSelected(event.target.value as PathModifier["type"]);
            }
          }}
        >
          <option value="">Add modifier…</option>
          <option value="simplify">Simplify</option>
          <option value="flatten">Flatten</option>
          <option value="offset">Offset</option>
          <option value="outline">Outline</option>
          <option value="smooth">Smooth</option>
          <option value="reverse">Reverse</option>
          <option value="boolean">Boolean…</option>
        </select>
      </div>
      {modifiers.length > 0 && (
        <button className="ghost-btn" onClick={applyPathModifiersSelected}>
          Apply modifiers
        </button>
      )}
    </Section>
  );
}
