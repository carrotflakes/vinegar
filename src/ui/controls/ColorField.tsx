import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react-dom";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuLink2Off, LuPlus } from "react-icons/lu";
import {
  isGradient,
  isSwatchRef,
  paintToCss,
  pattern,
  resolvePaintRef,
  solid,
  swatchRef,
  type Paint,
  type PatternMode,
  type PatternPaint,
} from "@/model/paint";
import {
  defaultGeometry,
  gradient,
  gradientStop,
  type GradientPaint,
} from "@/model/gradient";
import type { Bounds } from "@/model/types";
import { pickImageFiles } from "@/io/importImage";
import ColorPicker from "./ColorPicker";
import GradientEditor from "./GradientEditor";
import ScrubbableNumber from "./ScrubbableNumber";
import { usePopoverDismiss } from "./usePopoverDismiss";
import { useEditor } from "@/store/editorStore";
import "@/ui/Panel.css";
import "./ColorField.css";

/** Tooltips for the raster paint mapping modes. */
const PATTERN_MODE_HINTS: Record<PatternMode, string> = {
  fill: "Scale to cover the shape, cropping overflow",
  fit: "Scale to fit inside the shape",
  stretch: "Stretch to exactly fill the shape",
  tile: "Repeat the image across the shape",
};

/** Round to one decimal for the offset number inputs. */
const round1 = (n: number) => Math.round(n * 10) / 10;

const GRADIENT_LABELS: Record<GradientPaint["kind"], string> = {
  linear: "Linear",
  radial: "Radial",
  conic: "Conic",
};

interface Props {
  label: string;
  value: Paint | null;
  onChange: (v: Paint | null) => void;
  /** Fill bounds of the shape being edited; gradients are placed over it. */
  bounds?: Bounds | null;
}

export default function ColorField({ label, value, onChange, bounds = null }: Props) {
  const addRecentColor = useEditor((s) => s.addRecentColor);
  const assets = useEditor((s) => s.doc.assets);
  const addPatternImage = useEditor((s) => s.addPatternImage);
  // Document colours (global swatches) referenced by the current paint.
  const docSwatches = useEditor((s) => s.doc.swatches);
  const swatchOrder = useEditor((s) => s.doc.swatchOrder);
  const createSwatch = useEditor((s) => s.createSwatch);
  const updateSwatch = useEditor((s) => s.updateSwatch);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const enabled = value !== null;
  // A `swatch` reference resolves to the document swatch's concrete paint; the
  // whole field then behaves as that paint, but edits flow to the global.
  const ref = isSwatchRef(value) ? value : null;
  const linkedSwatch = ref ? docSwatches[ref.swatchId] : null;
  const concrete = resolvePaintRef(value, docSwatches);
  const kind = value === null ? "none" : concrete?.type ?? "solid"; // none|solid|gradient|pattern
  // Colour and alpha are edited independently; a paint keeps its alpha when the
  // colour changes (and vice-versa). Swatches/recents/palette store colours.
  const gradientPaint = concrete && isGradient(concrete) ? concrete : null;
  const color =
    concrete && concrete.type === "solid"
      ? concrete.color
      : gradientPaint
        ? gradientPaint.stops[0]?.color ?? "#888888"
        : "#888888";
  // Every concrete paint carries an alpha, and it survives a change of kind:
  // a 50% solid becomes a 50% gradient and comes back a 50% solid.
  const alpha = concrete ? concrete.alpha : 1;
  // While linked, colour/alpha edits update the global swatch (re-tinting every
  // use); otherwise they set this field's own paint.
  const setColor = (hex: string) =>
    ref && linkedSwatch
      ? updateSwatch(ref.swatchId, { paint: solid(hex, alpha) })
      : onChange(solid(hex, alpha));
  const setAlpha = (a: number) =>
    ref && linkedSwatch
      ? updateSwatch(ref.swatchId, { paint: solid(color, a) })
      : onChange(solid(color, a));
  // Save the current concrete colour as a new document colour and link to it.
  const createDocColor = () => onChange(swatchRef(createSwatch("", solid(color, alpha))));
  // Detach: bake the reference back to its concrete paint on this field only.
  const unlink = () => onChange(concrete);

  // ---- gradient editing --------------------------------------------------
  // Remember the last gradient so toggling away and back keeps its ramp.
  const lastGradient = useRef<GradientPaint | null>(null);
  if (gradientPaint) lastGradient.current = gradientPaint;
  const newGradient = () =>
    lastGradient.current ??
    // The solid's transparency belongs to the whole ramp, not just the stop it
    // came from — otherwise converting a 50% fill lands on an opaque white end.
    gradient([gradientStop(color, 0), gradientStop("#ffffff", 1)], {
      ...defaultGeometry("linear"),
      alpha,
    });

  // ---- pattern (raster fill) editing -------------------------------------
  const patternPaint = concrete && concrete.type === "pattern" ? concrete : null;
  // Remember the last chosen pattern so toggling away and back keeps its image.
  const lastPattern = useRef<PatternPaint | null>(null);
  if (patternPaint) lastPattern.current = patternPaint;
  const patternAsset = patternPaint ? assets[patternPaint.assetId] : null;
  const patternUrl = patternAsset?.source.data ?? null;
  // Existing document images are the primary source; import adds a new one.
  const imageAssets = Object.values(assets);
  const updatePattern = (patch: Partial<PatternPaint>) =>
    patternPaint && onChange({ ...patternPaint, ...patch });
  const pMode = patternPaint ? patternPaint.mode : "tile";
  // Point the pattern at an existing asset, keeping its other settings.
  const chooseAsset = (assetId: string) =>
    onChange(pattern(assetId, patternPaint ?? lastPattern.current ?? undefined));
  const importPattern = async () => {
    const [file] = await pickImageFiles();
    if (!file) return;
    const id = await addPatternImage(file);
    if (id) chooseAsset(id);
  };

  const setKind = (next: "none" | "solid" | "gradient" | "pattern") => {
    if (next === "none") return onChange(null);
    // Keep an existing document-colour link when "Solid" is (re)selected.
    if (next === "solid") return ref && linkedSwatch ? undefined : onChange(solid(color, alpha));
    if (next === "gradient") return onChange(newGradient());
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

  const close = () => {
    setOpen(false);
    // Patterns have no meaningful colour; don't push the gray fallback.
    if (enabled && value?.type !== "pattern") addRecentColor(color);
  };

  usePopoverDismiss(
    open,
    (t) =>
      !!rootRef.current?.contains(t) ||
      // The popover lives in a portal, and nested picker popovers (gradient
      // stops) portal to <body> as well.
      !!refs.floating.current?.contains(t) ||
      (t instanceof Element && !!t.closest("[data-color-popover]")),
    close
  );

  return (
    <div className="field color-field" ref={rootRef}>
      <label>{label}</label>
      <div className="field-row">
        <button
          ref={refs.setReference}
          className={"color-swatch" + (enabled ? "" : " is-none")}
          onClick={() => (open ? close() : setOpen(true))}
          title="Edit color"
        >
          {concrete && (
            <span
              className="swatch-fill"
              style={
                patternPaint && patternUrl
                  ? { backgroundImage: `url(${patternUrl})`, backgroundSize: "cover" }
                  : { background: paintToCss(concrete) }
              }
            />
          )}
        </button>
        <span className="swatch-text">
          {ref
            ? linkedSwatch?.name ?? "Missing color"
            : kind === "none"
              ? "none"
              : kind === "solid"
                ? alpha < 1
                  ? `${color} · ${Math.round(alpha * 100)}%`
                  : color
                : gradientPaint
                  ? GRADIENT_LABELS[gradientPaint.kind]
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
            {(["none", "solid", "gradient", "pattern"] as const).map((t) => (
              <button
                key={t}
                className={"paint-type-btn" + (kind === t ? " active" : "")}
                onClick={() => setKind(t)}
              >
                {t === "none"
                  ? "None"
                  : t === "solid"
                    ? "Solid"
                    : t === "gradient"
                      ? "Gradient"
                      : "Image"}
              </button>
            ))}
          </div>

          {ref && (
            <div className="swatch-link-badge">
              <LuLink2Off aria-hidden />
              <span className="swatch-link-name">
                {linkedSwatch
                  ? `Linked to “${linkedSwatch.name}”`
                  : "Linked color is missing"}
              </span>
              <button className="swatch-unlink" title="Unlink" onClick={unlink}>
                Unlink
              </button>
            </div>
          )}

          {kind === "solid" && (
            <>
              <ColorPicker
                value={color}
                onChange={setColor}
                alpha={alpha}
                onAlphaChange={setAlpha}
                showAlphaValue
              />

              <div className="color-pop-label">
                Global colors
                {!ref && (
                  <button
                    className="swatch-add"
                    title="Save as a document color and link"
                    onClick={createDocColor}
                  >
                    +
                  </button>
                )}
              </div>
              <div className="swatch-grid">
                {swatchOrder.length === 0 && (
                  <span className="swatch-hint">Shared colors that update every use</span>
                )}
                {swatchOrder.map((id) => {
                  const sw = docSwatches[id];
                  if (!sw) return null;
                  return (
                    <button
                      key={id}
                      className={
                        "mini-swatch" + (ref?.swatchId === id ? " selected" : "")
                      }
                      style={{ background: paintToCss(sw.paint) }}
                      title={sw.name}
                      onClick={() => onChange(swatchRef(id))}
                    />
                  );
                })}
              </div>
            </>
          )}

          {gradientPaint && (
            <GradientEditor
              value={gradientPaint}
              onChange={onChange}
              bounds={bounds}
            />
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
