import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react-dom";
import { useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { LuLink2Off, LuPlus } from "react-icons/lu";
import {
  isGradient,
  isSwatchRef,
  linearGradient,
  paintToCss,
  pattern,
  radialGradient,
  resolvePaintRef,
  solid,
  stopsToCssBar,
  swatchRef,
  type ConcretePaint,
  type GradientStop,
  type Paint,
  type PatternMode,
  type PatternPaint,
} from "@/model/paint";
import type { DocumentAsset } from "@/model/types";
import { pickImageFiles } from "@/io/importImage";
import ColorInput from "./ColorInput";
import ColorPicker from "./ColorPicker";
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

/** CSS for a paint preview chip. `paintToCss` covers solid and gradients; a
 *  pattern needs the decoded asset, which only document-aware callers have. */
function swatchChipStyle(
  paint: ConcretePaint,
  assets: Record<string, DocumentAsset>
): CSSProperties {
  if (paint.type !== "pattern") return { background: paintToCss(paint) };
  const url = assets[paint.assetId]?.source.data;
  return url
    ? { backgroundImage: `url(${url})`, backgroundSize: "cover" }
    : { background: paintToCss(paint) };
}

interface Props {
  label: string;
  value: Paint | null;
  onChange: (v: Paint | null) => void;
  /**
   * `field` (default) is a labelled property row that may hold "none" and may
   * link to a global colour. `swatch` edits a global colour *itself*: no label
   * or caption (the panel row supplies the name), no "None" (a swatch always
   * has a paint) and no global-colours section (swatches never chain).
   */
  variant?: "field" | "swatch";
}

export default function ColorField({ label, value, onChange, variant = "field" }: Props) {
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
  const kind = value === null ? "none" : concrete?.type ?? "solid"; // none|solid|linear|radial|pattern
  // Colour and alpha are edited independently; a paint keeps its alpha when the
  // colour changes (and vice-versa). Swatches/recents/palette store colours.
  const gradient = concrete && isGradient(concrete) ? concrete : null;
  const color =
    concrete && concrete.type === "solid"
      ? concrete.color
      : gradient
        ? gradient.stops[0]?.color ?? "#888888"
        : "#888888";
  const alpha = concrete && concrete.type === "solid" ? concrete.alpha : 1;
  /**
   * The single write path for every paint edit in this popover. While linked,
   * an edit updates the global swatch (re-tinting every use) instead of this
   * field, whatever the paint type — so switching a linked colour to a gradient
   * or restacking its stops edits the global rather than silently detaching.
   * Unlinked, it just sets this field's own paint.
   */
  const commit = (paint: ConcretePaint) =>
    ref && linkedSwatch
      ? updateSwatch(ref.swatchId, { paint })
      : onChange(paint);
  const setColor = (hex: string) => commit(solid(hex, alpha));
  const setAlpha = (a: number) => commit(solid(color, a));
  // Save the current concrete paint as a new document colour and link to it.
  const createDocColor = () =>
    concrete && onChange(swatchRef(createSwatch("", concrete)));
  // Detach: bake the reference back to its concrete paint on this field only.
  const unlink = () => onChange(concrete);

  // ---- gradient editing --------------------------------------------------
  const stops: GradientStop[] = gradient
    ? gradient.stops
    : [
        { offset: 0, color, alpha: 1 },
        { offset: 1, color: "#ffffff", alpha: 1 },
      ];
  const angle = concrete && concrete.type === "linear" ? concrete.angle : 0;
  const setStops = (next: GradientStop[]) =>
    commit(kind === "radial" ? radialGradient(next) : linearGradient(next, angle));
  const updateStop = (i: number, patch: Partial<GradientStop>) =>
    setStops(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStop = () =>
    setStops([...stops, { offset: 0.5, color: "#888888", alpha: 1 }]);
  const removeStop = (i: number) =>
    stops.length > 2 && setStops(stops.filter((_, j) => j !== i));

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
    patternPaint && commit({ ...patternPaint, ...patch });
  const pMode = patternPaint ? patternPaint.mode : "tile";
  // Point the pattern at an existing asset, keeping its other settings.
  const chooseAsset = (assetId: string) =>
    commit(pattern(assetId, patternPaint ?? lastPattern.current ?? undefined));
  const importPattern = async () => {
    const [file] = await pickImageFiles();
    if (!file) return;
    const id = await addPatternImage(file);
    if (id) chooseAsset(id);
  };

  // Switching type goes through `commit`, so a linked field retypes the global
  // colour and stays linked. "None" is the one exception: it is a property of
  // the field, not of a colour, so it drops the link instead.
  const setKind = (next: "none" | "solid" | "linear" | "radial" | "pattern") => {
    if (next === "none") return onChange(null);
    if (next === "solid") return commit(solid(color, alpha));
    if (next === "linear") return commit(linearGradient(stops, angle));
    if (next === "radial") return commit(radialGradient(stops));
    // Pattern: reuse a remembered image, else the first existing asset, else
    // import one now.
    const memo = patternPaint ?? lastPattern.current;
    if (memo) return commit(memo);
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
    if (enabled && concrete?.type !== "pattern") addRecentColor(color);
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

  const isSwatchEditor = variant === "swatch";

  return (
    <div
      className={"field color-field" + (isSwatchEditor ? " color-field-bare" : "")}
      ref={rootRef}
    >
      {!isSwatchEditor && <label>{label}</label>}
      <div className="field-row">
        <button
          ref={refs.setReference}
          className={"color-swatch" + (enabled ? "" : " is-none")}
          onClick={() => (open ? close() : setOpen(true))}
          title={isSwatchEditor ? label : "Edit color"}
        >
          {concrete && (
            <span className="swatch-fill" style={swatchChipStyle(concrete, assets)} />
          )}
        </button>
        {!isSwatchEditor && (
        <span className="swatch-text">
          {ref
            ? linkedSwatch?.name ?? "Missing color"
            : kind === "none"
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
        )}
      </div>

      {open &&
        createPortal(
          <div
            className="color-popover"
            ref={refs.setFloating}
            style={floatingStyles}
          >
          <div className="paint-type-row">
            {(isSwatchEditor
              ? (["solid", "linear", "radial", "pattern"] as const)
              : (["none", "solid", "linear", "radial", "pattern"] as const)
            ).map((t) => (
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
            <ColorPicker
              value={color}
              onChange={setColor}
              alpha={alpha}
              onAlphaChange={setAlpha}
              showAlphaValue
            />
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
                      commit(
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
                  <ColorInput
                    className="stop-color"
                    value={s.color}
                    onChange={(hex) => updateStop(i, { color: hex })}
                    alpha={s.alpha}
                    onAlphaChange={(a) => updateStop(i, { alpha: a })}
                    title="Stop color"
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

          {/* Global colours apply to every paint type, not just solid: a
              gradient or pattern can be a document colour too. */}
          {!isSwatchEditor && (
            <>
              <div className="color-pop-label">
                Global colors
                {!ref && concrete && (
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
                  <span className="swatch-hint">Shared paints that update every use</span>
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
                      style={swatchChipStyle(sw.paint, assets)}
                      title={sw.name}
                      onClick={() => onChange(swatchRef(id))}
                    />
                  );
                })}
              </div>
            </>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}
