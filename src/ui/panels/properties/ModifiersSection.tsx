import { LuArrowDownToLine } from "react-icons/lu";
import {
  PATH_MODIFIER_TYPES,
  type PathModifier,
  type PrimitiveShape,
} from "@/model/types";
import {
  clampFieldValue,
  PATH_MODIFIER_LABELS,
  PATH_MODIFIER_SPECS,
  type ModifierField,
} from "@/model/path/modifierSpec";
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
  /** One field, rendered from its declaration in the modifier spec. */
  const field = (index: number, modifier: PathModifier, spec: ModifierField) => {
    const value = (modifier as unknown as Record<string, unknown>)[spec.key];
    const write = (next: unknown) =>
      replace(index, { ...modifier, [spec.key]: next } as PathModifier);
    if (spec.kind === "choice") {
      return (
        <label className="field-inline" key={spec.key}>
          <span>{spec.label}</span>
          <select
            className="blend-select"
            value={String(value)}
            onChange={(event) => write(event.target.value)}
          >
            {spec.options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      );
    }
    return (
      <label className="geo-field" key={spec.key}>
        <span>{spec.label}</span>
        <BindableNumber
          nodeId={shape.id}
          path={modifierParamPath(index, spec.key)}
          label={spec.label}
          value={Math.round(Number(value) * 100) / 100}
          min={spec.min}
          step={spec.step ?? 1}
          onChange={(next) => write(clampFieldValue(spec, next))}
        />
      </label>
    );
  };

  /** A stage's whole parameter block: numbers in a grid, then the choices. */
  const fields = (index: number, modifier: PathModifier) => {
    const specs = PATH_MODIFIER_SPECS[modifier.type].fields;
    const numbers = specs.filter((spec) => spec.kind === "number");
    const choices = specs.filter((spec) => spec.kind === "choice");
    return (
      <>
        {numbers.length > 0 && (
          <div className="geometry-grid">
            {numbers.map((spec) => field(index, modifier, spec))}
          </div>
        )}
        {choices.map((spec) => field(index, modifier, spec))}
      </>
    );
  };

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
            value: modifier.enabled,
            onChange: () => replace(index, {
              ...modifier,
              enabled: !modifier.enabled,
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
          {fields(index, modifier)}
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
