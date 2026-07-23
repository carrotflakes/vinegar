import { LuChevronDown, LuChevronUp, LuX } from "react-icons/lu";
import { defaultEffect } from "../../../model/effects";
import type {
  DropShadowEffect,
  Effect,
  SceneNode,
} from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";

function effectLabel(type: Effect["type"]): string {
  if (type === "blur") return "Blur";
  if (type === "color-adjust") return "Color Adjust";
  if (type === "color-overlay") return "Color Overlay";
  return "Drop Shadow";
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
              <LuChevronUp aria-hidden />
            </button>
            <button
              className="ghost-btn icon-btn"
              title="Move down"
              disabled={index === effects.length - 1}
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
          ) : effect.type === "color-adjust" ? (
            <div className="geometry-grid">
              {numField(
                "Brightness",
                effect.brightness,
                (value) =>
                  replace(index, { ...effect, brightness: Math.max(0, value) }),
                { min: 0, step: 0.1 }
              )}
              {numField(
                "Contrast",
                effect.contrast,
                (value) =>
                  replace(index, { ...effect, contrast: Math.max(0, value) }),
                { min: 0, step: 0.1 }
              )}
              {numField(
                "Saturation",
                effect.saturation,
                (value) =>
                  replace(index, { ...effect, saturation: Math.max(0, value) }),
                { min: 0, step: 0.1 }
              )}
              {numField(
                "Hue",
                effect.hue,
                (value) => replace(index, { ...effect, hue: value }),
                { step: 1 }
              )}
            </div>
          ) : effect.type === "color-overlay" ? (
            <div className="field-inline">
              <label>Color</label>
              <div className="num-suffix">
                <input
                  type="color"
                  value={effect.color}
                  onChange={(event) =>
                    replace(index, { ...effect, color: event.target.value })
                  }
                />
                <ScrubbableNumber
                  className="num"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(effect.alpha * 100)}
                  onChange={(value) =>
                    replace(index, { ...effect, alpha: value / 100 })
                  }
                  aria-label="Overlay opacity"
                />
                <span className="unit">%</span>
              </div>
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
              <div className="field-inline">
                <label>Color</label>
                <div className="num-suffix">
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
                  <ScrubbableNumber
                    className="num"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(effect.alpha * 100)}
                    onChange={(value) =>
                      replace(index, { ...effect, alpha: value / 100 })
                    }
                    aria-label="Shadow opacity"
                  />
                  <span className="unit">%</span>
                </div>
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
          <option value="color-adjust">Color Adjust</option>
          <option value="color-overlay">Color Overlay</option>
        </select>
      </div>
    </div>
  );
}
