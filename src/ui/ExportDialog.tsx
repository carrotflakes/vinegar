import { useEffect, useMemo, useState } from "react";
import { LuX } from "react-icons/lu";
import { downloadBlob } from "../io/download";
import { fileSlug } from "../io/exportFilenames";
import {
  effectiveScale,
  exceedsPixelLimit,
  EXPORT_FORMATS,
  exportFilename,
  FORMAT_INFO,
  loadExportSettings,
  MAX_EXPORT_EDGE,
  outputPixelSize,
  resolveExportBounds,
  saveExportSettings,
  SCALE_PRESETS,
  supportsTransparency,
  toPngOptions,
  type ExportFormat,
  type ExportImageSettings,
  type ExportRegionContext,
  type ExportScope,
  type ExportSizeMode,
} from "../io/exportImage";
import { selectionContentBounds } from "../io/exportBounds";
import { exportPng } from "../io/exportPng";
import { useEditor } from "../store/editorStore";
import ScrubbableNumber from "./ScrubbableNumber";
import "./Modal.css";
import "./PreferencesDialog.css";
import "./ExportDialog.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SCOPE_LABELS: Record<ExportScope, string> = {
  content: "Content",
  artboard: "Artboard",
  selection: "Selection",
};

const SIZE_MODE_LABELS: Record<ExportSizeMode, string> = {
  scale: "Scale",
  width: "Width",
  height: "Height",
};

// Longest preview edge, in device pixels — keeps preview rendering cheap.
const PREVIEW_MAX_EDGE = 460;

export default function ExportDialog({ open, onClose }: Props) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const selectedArtboardId = useEditor((s) => s.selectedArtboardId);

  const [settings, setSettings] = useState<ExportImageSettings>(loadExportSettings);

  const artboard = useMemo(
    () => doc.artboards.find((ab) => ab.id === selectedArtboardId) ?? null,
    [doc.artboards, selectedArtboardId]
  );
  const hasArtboard = artboard != null;
  const selectionBounds = useMemo(
    () => selectionContentBounds(doc, selection, settings.margin),
    [doc, selection, settings.margin]
  );
  const hasSelection = selectionBounds != null;
  const region: ExportRegionContext = useMemo(
    () => ({ artboard, selectionBounds }),
    [artboard, selectionBounds]
  );

  const scopeAvailable = (scope: ExportScope) =>
    scope === "artboard" ? hasArtboard : scope === "selection" ? hasSelection : true;

  // On open, keep the remembered scope but fall back to Content when the stored
  // scope has nothing to export in the current selection state.
  useEffect(() => {
    if (!open) return;
    setSettings((prev) =>
      scopeAvailable(prev.scope) ? prev : { ...prev, scope: "content" }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasArtboard, hasSelection]);

  // Remember settings for next time.
  useEffect(() => {
    saveExportSettings(settings);
  }, [settings]);

  const update = (patch: Partial<ExportImageSettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  const format = FORMAT_INFO[settings.format];
  const canTransparent = supportsTransparency(settings);

  const bounds = useMemo(
    () => (open ? resolveExportBounds(doc, settings, region) : null),
    [open, doc, settings, region]
  );
  const dims = bounds ? outputPixelSize(settings, bounds) : null;
  const tooLarge = dims ? exceedsPixelLimit(dims) : false;
  const canExport = bounds != null && !tooLarge;

  // Live preview: render a downscaled image whenever inputs change (debounced).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !bounds || tooLarge) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    const handle = window.setTimeout(async () => {
      const longEdge = Math.max(bounds.width, bounds.height);
      const previewScale = Math.min(
        effectiveScale(settings, bounds),
        PREVIEW_MAX_EDGE / longEdge
      );
      try {
        const opts = toPngOptions(settings, bounds, artboard);
        const blob = await exportPng(doc, { ...opts, scale: previewScale });
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      } catch {
        if (!cancelled) setPreviewUrl(null);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, doc, settings, bounds, artboard, tooLarge]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const doExport = async () => {
    if (!bounds || !canExport) return;
    try {
      const blob = await exportPng(doc, toPngOptions(settings, bounds, artboard));
      const stem =
        settings.scope === "artboard" && artboard
          ? fileSlug(artboard.name)
          : "drawing";
      downloadBlob(blob, exportFilename(settings, stem));
      onClose();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <span id="export-title">Export image</span>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <LuX aria-hidden />
          </button>
        </div>

        <div className="export-body">
          <div className="export-preview">
            {previewUrl ? (
              <img src={previewUrl} alt="Export preview" />
            ) : (
              <span className="export-preview-empty">
                {!bounds
                  ? "Nothing to export"
                  : tooLarge
                  ? `Too large — max ${MAX_EXPORT_EDGE} px per side`
                  : "Rendering…"}
              </span>
            )}
          </div>

          <div className="pref-row">
            <div className="pref-text">
              <span className="pref-title">Range</span>
            </div>
            <div className="pref-control">
              <div className="pref-segmented" role="group" aria-label="Range">
                {(Object.keys(SCOPE_LABELS) as ExportScope[]).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    className={
                      "pref-seg" + (settings.scope === scope ? " active" : "")
                    }
                    aria-pressed={settings.scope === scope}
                    disabled={!scopeAvailable(scope)}
                    onClick={() => update({ scope })}
                  >
                    {SCOPE_LABELS[scope]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="pref-row">
            <div className="pref-text">
              <span className="pref-title">Format</span>
            </div>
            <div className="pref-control">
              <div className="pref-segmented" role="group" aria-label="Format">
                {EXPORT_FORMATS.map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    className={
                      "pref-seg" + (settings.format === fmt ? " active" : "")
                    }
                    aria-pressed={settings.format === fmt}
                    onClick={() => update({ format: fmt as ExportFormat })}
                  >
                    {FORMAT_INFO[fmt].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="pref-row">
            <div className="pref-text">
              <span className="pref-title">Size</span>
            </div>
            <div className="pref-control export-size">
              <select
                className="pref-select"
                style={{ width: "auto" }}
                value={settings.sizeMode}
                onChange={(e) =>
                  update({ sizeMode: e.target.value as ExportSizeMode })
                }
              >
                {(Object.keys(SIZE_MODE_LABELS) as ExportSizeMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {SIZE_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
              {settings.sizeMode === "scale" ? (
                <ScrubbableNumber
                  className="export-num"
                  min={0.01}
                  step={0.1}
                  value={settings.scale}
                  onChange={(scale) => update({ scale })}
                  aria-label="Scale factor"
                />
              ) : (
                <ScrubbableNumber
                  className="export-num"
                  min={1}
                  step={1}
                  value={settings.pixelSize}
                  onChange={(pixelSize) => update({ pixelSize })}
                  aria-label="Pixel size"
                />
              )}
            </div>
          </div>

          {settings.sizeMode === "scale" && (
            <div className="pref-row">
              <div className="pref-text" />
              <div className="pref-control">
                <div className="pref-segmented" role="group" aria-label="Scale presets">
                  {SCALE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={
                        "pref-seg" + (settings.scale === preset ? " active" : "")
                      }
                      aria-pressed={settings.scale === preset}
                      onClick={() => update({ scale: preset })}
                    >
                      {preset}×
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="pref-row">
            <div className="pref-text">
              <span className="pref-title">
                {canTransparent ? "Transparent background" : "Background"}
              </span>
              {!canTransparent && (
                <span className="pref-desc">
                  {format.label} has no transparency.
                </span>
              )}
            </div>
            <div className="pref-control export-size">
              <input
                type="color"
                className="export-swatch"
                value={settings.background}
                disabled={canTransparent && settings.transparent}
                onChange={(e) => update({ background: e.target.value })}
                aria-label="Background color"
              />
              <button
                type="button"
                role="switch"
                aria-checked={canTransparent && settings.transparent}
                disabled={!canTransparent}
                className={
                  "pref-switch" +
                  (canTransparent && settings.transparent ? " on" : "")
                }
                onClick={() => update({ transparent: !settings.transparent })}
              >
                <span className="pref-switch-knob" aria-hidden />
              </button>
            </div>
          </div>

          {format.lossy && (
            <div className="pref-row">
              <div className="pref-text">
                <span className="pref-title">Quality</span>
              </div>
              <div className="pref-control export-size">
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.01}
                  value={settings.quality}
                  onChange={(e) => update({ quality: Number(e.target.value) })}
                  aria-label="Quality"
                />
                <span className="export-dims">
                  {Math.round(settings.quality * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className={"export-dims" + (tooLarge ? " over" : "")}>
            {dims ? `${dims.width} × ${dims.height} px` : ""}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="preferences-button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="preferences-button primary"
              disabled={!canExport}
              onClick={doExport}
            >
              Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
