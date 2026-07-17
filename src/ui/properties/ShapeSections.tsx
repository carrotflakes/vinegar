import { useEffect, useReducer } from "react";
import {
  getAssetImage,
  subscribeImageCache,
} from "../../canvas/imageCache";
import { shapeBounds } from "../../model/bounds";
import {
  effectiveRectCornerRadius,
  maxRectCornerRadius,
} from "../../model/roundedRect";
import type {
  DocumentAsset,
  ImageShape,
  Shape,
  TextShape,
} from "../../model/types";
import { useEditor } from "../../store/editorStore";
import { FONT_OPTIONS } from "../fonts";
import ScrubbableNumber from "../ScrubbableNumber";

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export function ImageSection({
  shape,
  asset,
}: {
  shape: ImageShape;
  asset: DocumentAsset | null;
}) {
  const setImageLockAspect = useEditor(
    (state) => state.setImageLockAspect
  );
  const setShapeGeometry = useEditor(
    (state) => state.setShapeGeometry
  );
  const [, bump] = useReducer((value) => value + 1, 0);

  useEffect(() => subscribeImageCache(bump), []);

  const image = asset ? getAssetImage(asset) : null;
  const natural =
    image && image.naturalWidth > 0 && image.naturalHeight > 0
      ? { w: image.naturalWidth, h: image.naturalHeight }
      : null;

  return (
    <div className="panel-section">
      <div className="panel-title">Image</div>
      <div className="field">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={!!shape.lockAspect}
            onChange={(event) =>
              setImageLockAspect(shape.id, event.target.checked)
            }
          />
          Lock aspect ratio
        </label>
      </div>
      <div className="btn-row">
        <button
          className="ghost-btn"
          disabled={!natural}
          title={
            natural
              ? `Restore original pixel size (${natural.w}×${natural.h})`
              : "Decoding image…"
          }
          onClick={() =>
            natural &&
            setShapeGeometry(shape.id, {
              width: natural.w,
              height: natural.h,
            })
          }
        >
          Reset to natural size
        </button>
        <button
          className="ghost-btn"
          disabled={!natural}
          title="Fix the height to the image's natural aspect ratio"
          onClick={() =>
            natural &&
            setShapeGeometry(shape.id, {
              height: (shape.width * natural.h) / natural.w,
            })
          }
        >
          Reset aspect ratio
        </button>
      </div>
    </div>
  );
}

export function TextSection({ shape }: { shape: TextShape }) {
  const update = useEditor((state) => state.updateTextShape);

  return (
    <div className="panel-section">
      <div className="panel-title">Text</div>
      <div className="field">
        <label>Font</label>
        <select
          className="blend-select"
          value={shape.fontFamily}
          onChange={(event) =>
            update(shape.id, { fontFamily: event.target.value })
          }
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font.name} value={font.name}>
              {font.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Size</label>
        <div className="field-row">
          <ScrubbableNumber
            className="num"
            min={1}
            step={1}
            value={shape.fontSize}
            onChange={(value) =>
              update(shape.id, { fontSize: value })
            }
            aria-label="Font size"
          />
          <select
            className="blend-select"
            value={shape.fontWeight}
            onChange={(event) =>
              update(shape.id, {
                fontWeight: Number(event.target.value),
              })
            }
          >
            {FONT_WEIGHTS.map((weight) => (
              <option key={weight} value={weight}>{weight}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={shape.italic}
            onChange={(event) =>
              update(shape.id, { italic: event.target.checked })
            }
          />
          Italic
        </label>
      </div>
      <div className="field">
        <label>Line height</label>
        <ScrubbableNumber
          className="num"
          min={0.5}
          step={0.1}
          value={shape.lineHeight}
          onChange={(value) =>
            update(shape.id, { lineHeight: value })
          }
          aria-label="Line height"
        />
      </div>
      <div className="field">
        <label>Align</label>
        <select
          className="blend-select"
          value={shape.align}
          onChange={(event) =>
            update(shape.id, {
              align: event.target.value as TextShape["align"],
            })
          }
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
      {shape.textMode === "area" && (
        <div className="field">
          <label>Wrapping width</label>
          <ScrubbableNumber
            className="num"
            min={1}
            step={1}
            value={Math.round(shape.width)}
            onChange={(value) =>
              update(shape.id, { width: value })
            }
            aria-label="Wrapping width"
          />
        </div>
      )}
    </div>
  );
}

export function Geometry({ shape }: { shape: Shape }) {
  const setShapeGeometry = useEditor(
    (state) => state.setShapeGeometry
  );
  const setRectCornerRadius = useEditor(
    (state) => state.setRectCornerRadius
  );
  const bounds = shapeBounds(shape);
  const lockRatio =
    shape.type === "image" && shape.lockAspect && bounds.height > 0
      ? bounds.width / bounds.height
      : null;

  const field = (
    key: "x" | "y" | "width" | "height",
    label: string
  ) => (
    <label className="geo-field">
      <span>{label}</span>
      <ScrubbableNumber
        value={Math.round(bounds[key])}
        aria-label={label}
        onChange={(next) => {
          const patch: Partial<
            Record<"x" | "y" | "width" | "height", number>
          > = { [key]: next };
          if (lockRatio && key === "width") {
            patch.height = next / lockRatio;
          } else if (lockRatio && key === "height") {
            patch.width = next * lockRatio;
          }
          setShapeGeometry(shape.id, patch);
        }}
      />
    </label>
  );

  const radiusField = () => {
    if (shape.type !== "rect") return null;
    const radius = Math.round(effectiveRectCornerRadius(shape));
    return (
      <label className="geo-field">
        <span>R</span>
        <ScrubbableNumber
          min={0}
          max={maxRectCornerRadius(shape)}
          step={1}
          value={radius}
          aria-label="Corner radius"
          onChange={(value) =>
            setRectCornerRadius(shape.id, value)
          }
        />
      </label>
    );
  };

  return (
    <div className="geometry-grid">
      {field("x", "X")}
      {field("y", "Y")}
      {shape.type !== "text" && field("width", "W")}
      {shape.type !== "text" && field("height", "H")}
      {radiusField()}
    </div>
  );
}
