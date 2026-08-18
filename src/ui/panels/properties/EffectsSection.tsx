import { LuChevronDown, LuChevronUp, LuX } from "react-icons/lu";
import { defaultEffect, paintsGeometryEffects } from "../../../model/effects";
import { shapeBounds } from "@/model/geometry/bounds";
import { isShape } from "@/model/scene";
import { supportsStrokeAlignment } from "@/model/stroke";
import type {
  DropShadowEffect,
  Effect,
  SceneNode,
  StrokeAlignment,
  StrokeCap,
  StrokeJoin,
} from "../../../model/types";
import { useEditor } from "../../../store/editorStore";
import ColorField from "@/ui/controls/ColorField";
import ColorInput from "@/ui/controls/ColorInput";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import { BlendModeField } from "./StyleFields";
import Section from "../Section";

function effectLabel(type: Effect["type"]): string {
  if (type === "blur") return "Blur";
  if (type === "color-adjust") return "Color Adjust";
  if (type === "tint") return "Tint";
  if (type === "fill") return "Fill";
  if (type === "stroke") return "Stroke";
  return "Drop Shadow";
}

/** Shown on a fill/stroke effect that has no outline to paint. */
function GeometryNote() {
  return (
    <p className="effect-note">
      No effect here — Fill and Stroke paint the node's own outline, which
      groups, frames, images and live text do not have.
    </p>
  );
}

export default function EffectsSection({ node }: { node: SceneNode }) {
  const setNodeEffects = useEditor((state) => state.setNodeEffects);
  const effects = node.effects;
  const doc = useEditor((state) => state.doc);
  // Fill / Stroke paint the node's own outline, so they do nothing on a node
  // that has none. The controls still render (the entry is real and reorderable)
  // with a note saying so.
  const shape = isShape(node) ? node : null;
  const geometryEffective = !!shape && paintsGeometryEffects(shape, doc);
  const paintBounds = shape ? shapeBounds(shape, doc) : null;
  const alignmentEnabled = !!shape && supportsStrokeAlignment(shape);

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
    <Section title="Effects">
      {effects.map((effect, index) => (
        <div className="effect-card" key={effect.id}>
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
          ) : effect.type === "tint" ? (
            <div className="field-inline">
              <label>Color</label>
              <div className="num-suffix">
                <ColorInput
                  value={effect.color}
                  title="Tint color"
                  onChange={(hex) => replace(index, { ...effect, color: hex })}
                />
                <ScrubbableNumber
                  className="num"
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  value={Math.round(effect.alpha * 100)}
                  onChange={(value) =>
                    replace(index, { ...effect, alpha: value / 100 })
                  }
                  aria-label="Tint amount"
                />
              </div>
            </div>
          ) : effect.type === "fill" ? (
            <>
              <ColorField
                label="Paint"
                value={effect.paint}
                onChange={(paint) => replace(index, { ...effect, paint })}
                bounds={paintBounds}
                memoryKey={`${node.id}:effect:${effect.id}`}
              />
              <BlendModeField
                label="Blend"
                value={effect.blendMode}
                onChange={(blendMode) => replace(index, { ...effect, blendMode })}
              />
              {!geometryEffective && <GeometryNote />}
            </>
          ) : effect.type === "stroke" ? (
            <>
              <ColorField
                label="Paint"
                value={effect.paint}
                onChange={(paint) => replace(index, { ...effect, paint })}
                bounds={paintBounds}
                memoryKey={`${node.id}:effect:${effect.id}`}
              />
              <div className="geometry-grid">
                {numField(
                  "Width",
                  effect.width,
                  (value) => replace(index, { ...effect, width: Math.max(0, value) }),
                  { min: 0, step: 0.5 }
                )}
              </div>
              <div className="stroke-detail-grid">
                <label>
                  <span>Alignment</span>
                  <select
                    className="blend-select"
                    value={alignmentEnabled ? effect.alignment : "center"}
                    onChange={(event) =>
                      replace(index, {
                        ...effect,
                        alignment: event.target.value as StrokeAlignment,
                      })
                    }
                  >
                    <option value="inside" disabled={!alignmentEnabled}>Inside</option>
                    <option value="center">Center</option>
                    <option value="outside" disabled={!alignmentEnabled}>Outside</option>
                  </select>
                </label>
                <label>
                  <span>Cap</span>
                  <select
                    className="blend-select"
                    value={effect.cap}
                    onChange={(event) =>
                      replace(index, {
                        ...effect,
                        cap: event.target.value as StrokeCap,
                      })
                    }
                  >
                    <option value="butt">Butt</option>
                    <option value="round">Round</option>
                    <option value="square">Square</option>
                  </select>
                </label>
                <label>
                  <span>Join</span>
                  <select
                    className="blend-select"
                    value={effect.join}
                    onChange={(event) =>
                      replace(index, {
                        ...effect,
                        join: event.target.value as StrokeJoin,
                      })
                    }
                  >
                    <option value="miter">Miter</option>
                    <option value="round">Round</option>
                    <option value="bevel">Bevel</option>
                  </select>
                </label>
              </div>
              <BlendModeField
                label="Blend"
                value={effect.blendMode}
                onChange={(blendMode) => replace(index, { ...effect, blendMode })}
              />
              {!geometryEffective && <GeometryNote />}
            </>
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
                  <ColorInput
                    value={(effect as DropShadowEffect).color}
                    title="Shadow color"
                    onChange={(hex) => replace(index, { ...effect, color: hex })}
                  />
                  <ScrubbableNumber
                    className="num"
                    min={0}
                    max={100}
                    step={1}
                    unit="%"
                    value={Math.round(effect.alpha * 100)}
                    onChange={(value) =>
                      replace(index, { ...effect, alpha: value / 100 })
                    }
                    aria-label="Shadow opacity"
                  />
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
          {/* The two families do different things — one reworks the pixels
              below it, the other adds paint from the node's outline — so the
              menu says which is which rather than listing six flat entries. */}
          <optgroup label="Filter what is below">
            <option value="drop-shadow">Drop Shadow</option>
            <option value="blur">Blur</option>
            <option value="color-adjust">Color Adjust</option>
            <option value="tint">Tint</option>
          </optgroup>
          <optgroup label="Paint the outline">
            <option value="fill">Fill</option>
            <option value="stroke">Stroke</option>
          </optgroup>
        </select>
      </div>
    </Section>
  );
}
