import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react-dom";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuPipette, LuPlus } from "react-icons/lu";
import {
  isGradient,
  linearGradient,
  paintToCss,
  pattern,
  patternMode,
  radialGradient,
  solid,
  stopsToCssBar,
  type GradientStop,
  type Paint,
  type PatternMode,
  type PatternPaint,
} from "../model/paint";
import { pickImageFiles } from "../io/importImage";
import ScrubbableNumber from "./ScrubbableNumber";
import { useEditor } from "../store/editorStore";
import "./Panel.css";
import "./ColorField.css";

/** A curated default palette (grayscale + a hue wheel + tints). */
const PALETTE = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#efefef", "#ffffff",
  "#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#3949ab", "#8e24aa", "#d81b60",
  "#ffcdd2", "#ffe0b2", "#fff9c4", "#c8e6c9", "#bbdefb", "#c5cae9", "#e1bee7", "#f8bbd0",
];

/** Tooltips for the raster paint mapping modes. */
const PATTERN_MODE_HINTS: Record<PatternMode, string> = {
  fill: "Scale to cover the shape, cropping overflow",
  fit: "Scale to fit inside the shape",
  stretch: "Stretch to exactly fill the shape",
  tile: "Repeat the image across the shape",
};

/** Round to one decimal for the offset number inputs. */
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Normalize user-entered hex (#rgb or #rrggbb) to #rrggbb, or null if invalid. */
function normalizeHex(input: string): string | null {
  let v = input.trim().toLowerCase();
  if (!v.startsWith("#")) v = "#" + v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    v = "#" + v.slice(1).split("").map((c) => c + c).join("");
  }
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

interface Props {
  label: string;
  value: Paint | null;
  onChange: (v: Paint | null) => void;
}

export default function ColorField({ label, value, onChange }: Props) {
  const recentColors = useEditor((s) => s.recentColors);
  const addRecentColor = useEditor((s) => s.addRecentColor);
  const savedSwatches = useEditor((s) => s.savedSwatches);
  const addSwatch = useEditor((s) => s.addSwatch);
  const removeSwatch = useEditor((s) => s.removeSwatch);
  const assets = useEditor((s) => s.doc.assets);
  const addPatternImage = useEditor((s) => s.addPatternImage);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const enabled = value !== null;
  const kind = value === null ? "none" : value.type; // none|solid|linear|radial|pattern
  // Colour and alpha are edited independently; a paint keeps its alpha when the
  // colour changes (and vice-versa). Swatches/recents/palette store colours.
  const gradient = value && isGradient(value) ? value : null;
  const color =
    value && value.type === "solid"
      ? value.color
      : gradient
        ? gradient.stops[0]?.color ?? "#888888"
        : "#888888";
  const alpha = value && value.type === "solid" ? value.alpha : 1;
  const setColor = (hex: string) => onChange(solid(hex, alpha));
  const setAlpha = (a: number) => onChange(solid(color, a));
  const hasEyeDropper = typeof window !== "undefined" && !!window.EyeDropper;

  // ---- gradient editing --------------------------------------------------
  const stops: GradientStop[] = gradient
    ? gradient.stops
    : [
        { offset: 0, color, alpha: 1 },
        { offset: 1, color: "#ffffff", alpha: 1 },
      ];
  const angle = value && value.type === "linear" ? value.angle : 0;
  const setStops = (next: GradientStop[]) =>
    onChange(kind === "radial" ? radialGradient(next) : linearGradient(next, angle));
  const updateStop = (i: number, patch: Partial<GradientStop>) =>
    setStops(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStop = () =>
    setStops([...stops, { offset: 0.5, color: "#888888", alpha: 1 }]);
  const removeStop = (i: number) =>
    stops.length > 2 && setStops(stops.filter((_, j) => j !== i));

  // ---- pattern (raster fill) editing -------------------------------------
  const patternPaint = value && value.type === "pattern" ? value : null;
  // Remember the last chosen pattern so toggling away and back keeps its image.
  const lastPattern = useRef<PatternPaint | null>(null);
  if (patternPaint) lastPattern.current = patternPaint;
  const patternAsset = patternPaint ? assets[patternPaint.assetId] : null;
  const patternUrl = patternAsset?.source.data ?? null;
  // Existing document images are the primary source; import adds a new one.
  const imageAssets = Object.values(assets);
  const updatePattern = (patch: Partial<PatternPaint>) =>
    patternPaint && onChange({ ...patternPaint, ...patch });
  const pMode = patternPaint ? patternMode(patternPaint) : "tile";
  // Point the pattern at an existing asset, keeping its other settings.
  const chooseAsset = (assetId: string) =>
    onChange(pattern(assetId, patternPaint ?? lastPattern.current ?? undefined));
  const importPattern = async () => {
    const [file] = await pickImageFiles();
    if (!file) return;
    const id = await addPatternImage(file);
    if (id) chooseAsset(id);
  };

  const setKind = (next: "none" | "solid" | "linear" | "radial" | "pattern") => {
    if (next === "none") return onChange(null);
    if (next === "solid") return onChange(solid(color, alpha));
    if (next === "linear") return onChange(linearGradient(stops, angle));
    if (next === "radial") return onChange(radialGradient(stops));
    // Pattern: reuse a remembered image, else the first existing asset, else
    // import one now.
    const memo = patternPaint ?? lastPattern.current;
    if (memo) return onChange(memo);
    if (imageAssets[0]) return chooseAsset(imageAssets[0].id);
    return void importPattern();
  };

  // The popover portals to <body> so the sidebar's overflow can't clip it;
  // Floating UI keeps it anchored to the swatch (and inside the viewport).
  const { refs, floatingStyles } = useFloating({
    placement: "bottom-start",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const pickFromScreen = async () => {
    if (!window.EyeDropper) return;
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      setColor(sRGBHex.toLowerCase());
    } catch {
      // user cancelled
    }
  };

  const close = () => {
    setOpen(false);
    // Patterns have no meaningful colour; don't push the gray fallback.
    if (enabled && value?.type !== "pattern") addRecentColor(color);
  };

  // Dismiss on outside press or Escape. Uses pointerdown (not mousedown):
  // the canvas captures pointers on pointerdown, which suppresses the
  // compatibility mouse events a mousedown listener would rely on.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (refs.floating.current?.contains(t)) return; // popover lives in a portal
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture phase: closing the popover shouldn't also clear selection.
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  return (
    <div className="field color-field" ref={rootRef}>
      <label>{label}</label>
      <div className="field-row">
        <button
          ref={refs.setReference}
          className={"color-swatch" + (enabled ? "" : " is-none")}
          onClick={() => setOpen((o) => !o)}
          title="Edit color"
        >
          {value && (
            <span
              className="swatch-fill"
              style={
                patternPaint && patternUrl
                  ? { backgroundImage: `url(${patternUrl})`, backgroundSize: "cover" }
                  : { background: paintToCss(value) }
              }
            />
          )}
        </button>
        <span className="swatch-text">
          {kind === "none"
            ? "none"
            : kind === "solid"
              ? alpha < 1
                ? `${color} · ${Math.round(alpha * 100)}%`
                : color
              : kind === "linear"
                ? "Linear"
                : kind === "radial"
                  ? "Radial"
                  : "Image"}
        </span>
      </div>

      {open &&
        createPortal(
          <div
            className="color-popover"
            ref={refs.setFloating}
            style={floatingStyles}
          >
          <div className="paint-type-row">
            {(["none", "solid", "linear", "radial", "pattern"] as const).map((t) => (
              <button
                key={t}
                className={"paint-type-btn" + (kind === t ? " active" : "")}
                onClick={() => setKind(t)}
              >
                {t === "none"
                  ? "None"
                  : t === "solid"
                    ? "Solid"
                    : t === "linear"
                      ? "Linear"
                      : t === "radial"
                        ? "Radial"
                        : "Image"}
              </button>
            ))}
          </div>

          {kind === "solid" && (
            <>
              <div className="color-pop-row">
                <input
                  type="color"
                  className="color-spectrum"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
                {hasEyeDropper && (
                  <button
                    className="icon-btn"
                    title="Pick color from screen"
                    onClick={pickFromScreen}
                  >
                    <LuPipette aria-hidden />
                  </button>
                )}
                <input
                  key={color}
                  className="hex-input"
                  defaultValue={color.replace("#", "")}
                  placeholder="rrggbb"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  onBlur={(e) => {
                    const n = normalizeHex(e.target.value);
                    if (n) setColor(n);
                  }}
                />
              </div>

              <div className="color-pop-alpha">
                <span className="alpha-label">Alpha</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(alpha * 100)}
                  onChange={(e) => setAlpha(Number(e.target.value) / 100)}
                />
                <span className="alpha-value">{Math.round(alpha * 100)}%</span>
              </div>

              <div className="color-pop-label">
                Saved
                <button
                  className="swatch-add"
                  title="Save current color"
                  onClick={() => addSwatch(color)}
                >
                  +
                </button>
              </div>
              <div className="swatch-grid">
                {savedSwatches.length === 0 && (
                  <span className="swatch-hint">Save colors with +</span>
                )}
                {savedSwatches.map((c) => (
                  <button
                    key={c}
                    className="mini-swatch"
                    style={{ background: c }}
                    title={`${c} — Alt-click to remove`}
                    onClick={(e) => (e.altKey ? removeSwatch(c) : setColor(c))}
                  />
                ))}
              </div>

              {recentColors.length > 0 && (
                <>
                  <div className="color-pop-label">Recent</div>
                  <div className="swatch-grid">
                    {recentColors.map((c) => (
                      <button
                        key={c}
                        className="mini-swatch"
                        style={{ background: c }}
                        title={c}
                        onClick={() => setColor(c)}
                      />
                    ))}
                  </div>
                </>
              )}

              <div className="color-pop-label">Palette</div>
              <div className="swatch-grid">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    className="mini-swatch"
                    style={{ background: c }}
                    title={c}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </>
          )}

          {gradient && (
            <>
              <div
                className="gradient-bar"
                style={{ background: stopsToCssBar(stops) }}
              />
              {kind === "linear" && (
                <div className="color-pop-alpha">
                  <span className="alpha-label">Angle</span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={Math.round((angle * 180) / Math.PI)}
                    onChange={(e) =>
                      onChange(
                        linearGradient(
                          stops,
                          (Number(e.target.value) * Math.PI) / 180
                        )
                      )
                    }
                  />
                  <span className="alpha-value">
                    {Math.round((angle * 180) / Math.PI)}°
                  </span>
                </div>
              )}
              <div className="color-pop-label">
                Stops
                <button
                  className="swatch-add"
                  title="Add a stop"
                  onClick={addStop}
                >
                  +
                </button>
              </div>
              {stops.map((s, i) => (
                <div className="gradient-stop" key={i}>
                  <input
                    type="color"
                    className="stop-color"
                    value={s.color}
                    onChange={(e) => updateStop(i, { color: e.target.value })}
                  />
                  <input
                    type="range"
                    className="stop-offset"
                    min={0}
                    max={100}
                    value={Math.round(s.offset * 100)}
                    onChange={(e) =>
                      updateStop(i, { offset: Number(e.target.value) / 100 })
                    }
                    title="Position"
                  />
                  <input
                    type="range"
                    className="stop-alpha"
                    min={0}
                    max={100}
                    value={Math.round(s.alpha * 100)}
                    onChange={(e) =>
                      updateStop(i, { alpha: Number(e.target.value) / 100 })
                    }
                    title="Alpha"
                  />
                  <button
                    className="stop-remove"
                    title="Remove stop"
                    disabled={stops.length <= 2}
                    onClick={() => removeStop(i)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </>
          )}

          {patternPaint && (
            <>
              <div className="color-pop-label">Image</div>
              <div className="pattern-assets">
                {imageAssets.map((a) => (
                  <button
                    key={a.id}
                    className={
                      "pattern-asset" +
                      (a.id === patternPaint.assetId ? " selected" : "")
                    }
                    style={{ backgroundImage: `url(${a.source.data})` }}
                    title={a.name || "Untitled"}
                    onClick={() => chooseAsset(a.id)}
                  />
                ))}
                <button
                  className="pattern-asset pattern-asset-import"
                  title="Import an image…"
                  onClick={importPattern}
                >
                  <LuPlus aria-hidden />
                </button>
              </div>
              {!patternUrl && (
                <span className="swatch-hint">Selected image is missing</span>
              )}

              <div className="paint-type-row pattern-mode-row">
                {(["fill", "fit", "stretch", "tile"] as const).map((m) => (
                  <button
                    key={m}
                    className={"paint-type-btn" + (pMode === m ? " active" : "")}
                    onClick={() => updatePattern({ mode: m as PatternMode })}
                    title={PATTERN_MODE_HINTS[m]}
                  >
                    {m === "fill"
                      ? "Fill"
                      : m === "fit"
                        ? "Fit"
                        : m === "stretch"
                          ? "Stretch"
                          : "Tile"}
                  </button>
                ))}
              </div>

              {pMode !== "stretch" && (
                <div className="color-pop-alpha">
                  <span className="alpha-label">
                    {pMode === "tile" ? "Scale" : "Zoom"}
                  </span>
                  <input
                    type="range"
                    min={pMode === "tile" ? 5 : 25}
                    max={400}
                    value={Math.round(patternPaint.scale * 100)}
                    onChange={(e) =>
                      updatePattern({ scale: Number(e.target.value) / 100 })
                    }
                  />
                  <span className="alpha-value">
                    {Math.round(patternPaint.scale * 100)}%
                  </span>
                </div>
              )}

              {pMode === "tile" && (
                <div className="color-pop-alpha">
                  <span className="alpha-label">Rotate</span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={Math.round((patternPaint.rotation * 180) / Math.PI)}
                    onChange={(e) =>
                      updatePattern({
                        rotation: (Number(e.target.value) * Math.PI) / 180,
                      })
                    }
                  />
                  <span className="alpha-value">
                    {Math.round((patternPaint.rotation * 180) / Math.PI)}°
                  </span>
                </div>
              )}

              {pMode !== "stretch" && (
                <div className="pattern-offset">
                  <span className="alpha-label">
                    {pMode === "tile" ? "Origin" : "Offset"}
                  </span>
                  <label className="offset-input">
                    X
                    <ScrubbableNumber
                      value={round1(patternPaint.offset.x)}
                      onChange={(x) =>
                        updatePattern({ offset: { ...patternPaint.offset, x } })
                      }
                      aria-label="Pattern offset X"
                    />
                  </label>
                  <label className="offset-input">
                    Y
                    <ScrubbableNumber
                      value={round1(patternPaint.offset.y)}
                      onChange={(y) =>
                        updatePattern({ offset: { ...patternPaint.offset, y } })
                      }
                      aria-label="Pattern offset Y"
                    />
                  </label>
                </div>
              )}

              <div className="color-pop-alpha">
                <span className="alpha-label">Alpha</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(patternPaint.alpha * 100)}
                  onChange={(e) =>
                    updatePattern({ alpha: Number(e.target.value) / 100 })
                  }
                />
                <span className="alpha-value">
                  {Math.round(patternPaint.alpha * 100)}%
                </span>
              </div>
            </>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}
