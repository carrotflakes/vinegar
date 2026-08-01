import { LuChevronDown, LuChevronUp, LuX } from "react-icons/lu";
import type { PathModifier, PathShape } from "@/model/types";
import { useEditor } from "@/store/editorStore";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import Section from "../Section";

function modifierLabel(type: PathModifier["type"]): string {
  switch (type) {
    case "simplify": return "Simplify";
    case "flatten": return "Flatten";
    case "offset": return "Offset";
    case "outline": return "Outline";
    case "smooth": return "Smooth";
    case "reverse": return "Reverse";
  }
}

export default function ModifiersSection({ shape }: { shape: PathShape }) {
  const setPathModifiers = useEditor((state) => state.setPathModifiers);
  const addPathModifierSelected = useEditor((state) => state.addPathModifierSelected);
  const applyPathModifiersSelected = useEditor((state) => state.applyPathModifiersSelected);
  const beginInteraction = useEditor((state) => state.beginInteraction);
  const endInteraction = useEditor((state) => state.endInteraction);
  const cancelInteraction = useEditor((state) => state.cancelInteraction);
  const modifiers = shape.modifiers ?? [];

  const replace = (index: number, next: PathModifier) =>
    setPathModifiers(
      shape.id,
      modifiers.map((modifier, modifierIndex) =>
        modifierIndex === index ? next : modifier
      )
    );
  const remove = (index: number) =>
    setPathModifiers(
      shape.id,
      modifiers.filter((_, modifierIndex) => modifierIndex !== index)
    );
  const move = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= modifiers.length) return;
    const next = [...modifiers];
    [next[index], next[destination]] = [next[destination], next[index]];
    setPathModifiers(shape.id, next);
  };
  const numberField = (
    label: string,
    value: number,
    onChange: (value: number) => void,
    min?: number
  ) => (
    <label className="geo-field">
      <span>{label}</span>
      <ScrubbableNumber
        className="num"
        value={Math.round(value * 100) / 100}
        min={min}
        step={0.1}
        onChange={onChange}
        onScrubStart={() => beginInteraction("Edit path modifier")}
        onScrubEnd={endInteraction}
        onScrubCancel={cancelInteraction}
        aria-label={label}
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
              {numberField("Tolerance", modifier.tolerance, (value) =>
                replace(index, { ...modifier, tolerance: Math.max(0, value) }), 0
              )}
            </div>
          ) : modifier.type === "offset" ? (
            <>
              <div className="geometry-grid">
                {numberField("Distance", modifier.distance, (value) =>
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
          ) : modifier.type === "outline" ? (
            <>
              <div className="geometry-grid">
                {numberField("Width", modifier.width, (value) =>
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
