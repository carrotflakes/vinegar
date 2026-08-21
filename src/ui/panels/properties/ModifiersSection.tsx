import { LuArrowDownToLine } from "react-icons/lu";
import {
  PATH_MODIFIER_TYPES,
  type DeformStyle,
  type PathModifier,
  type PrimitiveShape,
} from "@/model/types";
import { PATH_MODIFIER_LABELS } from "@/model/path/pathModifiers";
import { useEditor } from "@/store/editorStore";
import { modifierParamPath, remapModifierBindings } from "@/model/params";
import BindableNumber from "@/ui/controls/BindableNumber";
import Section from "../Section";
import StackCard from "./StackCard";

export default function ModifiersSection({ shape }: { shape: PrimitiveShape }) {
  const setPathModifiers = useEditor((state) => state.setPathModifiers);
  const addPathModifierSelected = useEditor((state) => state.addPathModifierSelected);
  const applyPathModifiersSelected = useEditor((state) => state.applyPathModifiersSelected);
  const applyPathModifiersUpTo = useEditor((state) => state.applyPathModifiersUpTo);
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
    min?: number,
    step = 0.1
  ) => (
    <label className="geo-field">
      <span>{label}</span>
      <BindableNumber
        nodeId={shape.id}
        path={modifierParamPath(index, key)}
        label={label}
        value={Math.round(value * 100) / 100}
        min={min}
        step={step}
        onChange={onChange}
      />
    </label>
  );

  const styleField = (
    index: number,
    value: DeformStyle,
    apply: (style: DeformStyle) => PathModifier
  ) => (
    <label className="field-inline">
      <span>Points</span>
      <select
        className="blend-select"
        value={value}
        onChange={(event) => replace(index, apply(event.target.value as DeformStyle))}
      >
        <option value="corner">Corner</option>
        <option value="smooth">Smooth</option>
      </select>
    </label>
  );

  return (
    <Section id="properties.modifiers" title="Modifiers">
      {modifiers.map((modifier, index) => (
        <StackCard
          key={index}
          name={PATH_MODIFIER_LABELS[modifier.type]}
          index={index}
          count={modifiers.length}
          onMove={(direction) => move(index, direction)}
          onRemove={() => remove(index)}
          enabled={{
            value: modifier.enabled !== false,
            onChange: () => replace(index, {
              ...modifier,
              enabled: modifier.enabled === false,
            }),
          }}
          actions={
            <button
              className="ghost-btn icon-btn"
              title="Apply up to here — bakes this stage and every stage above it"
              aria-label={`Apply ${PATH_MODIFIER_LABELS[modifier.type]} up to here`}
              onClick={() => applyPathModifiersUpTo(shape.id, index)}
            >
              <LuArrowDownToLine aria-hidden />
            </button>
          }
        >
          {modifier.type === "simplify" || modifier.type === "flatten" ? (
            <div className="geometry-grid">
              {numberField(index, "tolerance", "Tolerance", modifier.tolerance, (value) =>
                replace(index, { ...modifier, tolerance: Math.max(0, value) }), 0
              )}
            </div>
          ) : modifier.type === "round" ? (
            <div className="geometry-grid">
              {numberField(index, "radius", "Radius", modifier.radius, (value) =>
                replace(index, { ...modifier, radius: Math.max(0, value) }), 0
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
          ) : modifier.type === "zigzag" ? (
            <>
              <div className="geometry-grid">
                {numberField(index, "amplitude", "Size", modifier.amplitude, (value) =>
                  replace(index, { ...modifier, amplitude: value })
                )}
                {numberField(index, "wavelength", "Spacing", modifier.wavelength,
                  (value) => replace(index, {
                    ...modifier,
                    wavelength: Math.max(0.1, value),
                  }), 0.1
                )}
              </div>
              {styleField(index, modifier.style, (style) => ({ ...modifier, style }))}
            </>
          ) : modifier.type === "roughen" ? (
            <>
              <div className="geometry-grid">
                {numberField(index, "size", "Size", modifier.size, (value) =>
                  replace(index, { ...modifier, size: Math.max(0, value) }), 0
                )}
                {numberField(index, "detail", "Spacing", modifier.detail, (value) =>
                  replace(index, { ...modifier, detail: Math.max(0.1, value) }), 0.1
                )}
                {numberField(index, "seed", "Seed", modifier.seed, (value) =>
                  replace(index, { ...modifier, seed: Math.max(0, Math.round(value)) }),
                  0, 1
                )}
              </div>
              {styleField(index, modifier.style, (style) => ({ ...modifier, style }))}
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
        </StackCard>
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
          {PATH_MODIFIER_TYPES.map((type) => (
            <option key={type} value={type}>{PATH_MODIFIER_LABELS[type]}</option>
          ))}
        </select>
      </div>
      {modifiers.length > 0 && (
        <button
          className="ghost-btn"
          title={shape.type === "path"
            ? "Bake the stack into the path's anchors"
            : "Bake the stack — the shape becomes a path"}
          onClick={applyPathModifiersSelected}
        >
          Apply modifiers
        </button>
      )}
    </Section>
  );
}
