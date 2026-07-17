import { defaultEffect } from "../../model/effects";
import type {
  DropShadowEffect,
  Effect,
  SceneNode,
} from "../../model/types";
import { useEditor } from "../../store/editorStore";
import ScrubbableNumber from "../ScrubbableNumber";

function effectLabel(type: Effect["type"]): string {
  return type === "blur" ? "Blur" : "Drop Shadow";
}

export default function EffectsSection({ node }: { node: SceneNode }) {
  const setNodeEffects = useEditor((state) => state.setNodeEffects);
  const effects = node.effects ?? [];

  const replace = (index: number, next: Effect) =>
    setNodeEffects(
      node.id,
      effects.map((effect, effectIndex) =>
        effectIndex === index ? next : effect
      )
    );
  const remove = (index: number) =>
    setNodeEffects(
      node.id,
      effects.filter((_, effectIndex) => effectIndex !== index)
    );
  const move = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= effects.length) return;
    const next = [...effects];
    [next[index], next[destination]] = [
      next[destination],
      next[index],
    ];
    setNodeEffects(node.id, next);
  };
  const add = (type: Effect["type"]) =>
    setNodeEffects(node.id, [...effects, defaultEffect(type)]);

  const numField = (
    label: string,
    value: number,
    onChange: (next: number) => void,
    options: { min?: number; step?: number } = {}
  ) => (
    <label className="geo-field">
      <span>{label}</span>
      <ScrubbableNumber
        className="num"
        min={options.min}
        step={options.step ?? 1}
        value={Math.round(value * 100) / 100}
        onChange={onChange}
        aria-label={label}
      />
    </label>
  );

  return (
    <div className="panel-section">
      <div className="panel-title">Effects</div>
      {effects.map((effect, index) => (
        <div className="effect-card" key={index}>
          <div className="field-row effect-head">
            <span className="effect-name">
              {effectLabel(effect.type)}
            </span>
            <button
              className="ghost-btn icon-btn"
              title="Move up"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              ↑
            </button>
            <button
              className="ghost-btn icon-btn"
              title="Move down"
              disabled={index === effects.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              className="ghost-btn icon-btn danger"
              title="Remove"
              onClick={() => remove(index)}
            >
              ✕
            </button>
          </div>
          {effect.type === "blur" ? (
            <div className="geometry-grid">
              {numField(
                "Radius",
                effect.radius,
                (value) =>
                  replace(index, {
                    ...effect,
                    radius: Math.max(0, value),
                  }),
                { min: 0 }
              )}
            </div>
          ) : (
            <>
              <div className="geometry-grid">
                {numField("X", effect.offsetX, (value) =>
                  replace(index, { ...effect, offsetX: value })
                )}
                {numField("Y", effect.offsetY, (value) =>
                  replace(index, { ...effect, offsetY: value })
                )}
                {numField(
                  "Blur",
                  effect.blur,
                  (value) =>
                    replace(index, {
                      ...effect,
                      blur: Math.max(0, value),
                    }),
                  { min: 0 }
                )}
              </div>
              <div className="field-row">
                <input
                  type="color"
                  value={(effect as DropShadowEffect).color}
                  onChange={(event) =>
                    replace(index, {
                      ...effect,
                      color: event.target.value,
                    })
                  }
                />
                <label className="geo-field">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={effect.alpha}
                    onChange={(event) =>
                      replace(index, {
                        ...effect,
                        alpha: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <span className="num readout">
                  {Math.round(effect.alpha * 100)}%
                </span>
              </div>
            </>
          )}
        </div>
      ))}
      <div className="field">
        <select
          className="blend-select"
          value=""
          onChange={(event) => {
            if (event.target.value) {
              add(event.target.value as Effect["type"]);
            }
          }}
        >
          <option value="">Add effect…</option>
          <option value="drop-shadow">Drop Shadow</option>
          <option value="blur">Blur</option>
        </select>
      </div>
    </div>
  );
}
