import { useEffect, useMemo, useState } from "react";
import { LuX } from "react-icons/lu";
import { downloadBlob } from "../../io/download";
import { selectionContentBounds } from "../../io/exportBounds";
import { fileSlug } from "../../io/exportFilenames";
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
  type ExportOutput,
  type ExportRegionContext,
  type ExportScope,
  type ExportSizeMode,
} from "../../io/exportImage";
import { exportPng } from "../../io/exportPng";
import { useEditor } from "../../store/editorStore";
import { anyMenuOpen } from "../../store/menuStore";
import { notify } from "../../store/toastStore";
import "../Modal.css";
import "./DialogForm.css";
import ColorInput from "@/ui/controls/ColorInput";
import ScrubbableNumber from "@/ui/controls/ScrubbableNumber";
import "./ExportDialog.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SCOPE_LABELS: Record<ExportScope, string> = {
  content: "Content",
  frame: "Frame",
  selection: "Selection",
};

const OUTPUT_LABELS: Record<ExportOutput, string> = {
  file: "File",
  clipboard: "Clipboard",
  asset: "Asset",
  share: "Share",
};

/** Verb on the confirm button for each output. */
const OUTPUT_ACTIONS: Record<ExportOutput, string> = {
  file: "Export",
  clipboard: "Copy",
  asset: "Add to asset",
  share: "Share",
};

const OUTPUT_HINTS: Record<ExportOutput, string> = {
  file: "Download the image as a file.",
  clipboard: "Copy the image to the system clipboard — always PNG.",
  asset: "Keep the image inside this document as an asset.",
  share: "Hand the image to the system share sheet.",
};

const SIZE_MODE_LABELS: Record<ExportSizeMode, string> = {
  scale: "Scale",
  width: "Width",
  height: "Height",
};

// Longest preview edge, in device pixels — keeps preview rendering cheap.
const PREVIEW_MAX_EDGE = 460;

/**
 * Whether this browser can share files at all. `navigator.share` alone is not
 * enough — some implementations take text but refuse files — so probe with an
 * empty stand-in file of the type we would actually send.
 */
function canShareFiles(): boolean {
  if (typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({
      files: [new File([], "export.png", { type: "image/png" })],
    });
  } catch {
    return false;
  }
}

export default function ExportDialog({ open, onClose }: Props) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const addImageAsset = useEditor((s) => s.addImageAsset);

  const [settings, setSettings] = useState<ExportImageSettings>(loadExportSettings);
  // Clipboard and share are browser capabilities, not user choices: outputs the
  // browser cannot do are dropped from the row rather than shown disabled.
  const canShare = useMemo(canShareFiles, []);
  const canCopy = useMemo(
    () =>
      typeof ClipboardItem !== "undefined" &&
      typeof navigator.clipboard?.write === "function",
    []
  );
  const outputs = useMemo(
    () =>
      (Object.keys(OUTPUT_LABELS) as ExportOutput[]).filter(
        (output) =>
          (output !== "clipboard" || canCopy) && (output !== "share" || canShare)
      ),
    [canCopy, canShare]
  );

  // Export scope "frame" targets a lone selected frame node.
  const frame = useMemo(() => {
    if (selection.length !== 1) return null;
    const node = doc.nodes[selection[0]];
    return node?.type === "frame" ? node : null;
  }, [doc, selection]);
  const hasFrame = frame != null;
  const selectionBounds = useMemo(
    () => selectionContentBounds(doc, selection, settings.margin),
    [doc, selection, settings.margin]
  );
  const hasSelection = selectionBounds != null;
  const region: ExportRegionContext = useMemo(
    () => ({ frame, selectionBounds }),
    [frame, selectionBounds]
  );

  const scopeAvailable = (scope: ExportScope) =>
    scope === "frame" ? hasFrame : scope === "selection" ? hasSelection : true;

  // On open, keep the remembered scope and output but fall back when the stored
  // scope has nothing to export in the current selection state, or the stored
  // output is not something this browser can do.
  useEffect(() => {
    if (!open) return;
    setSettings((prev) => {
      const next = { ...prev };
      if (!scopeAvailable(prev.scope)) next.scope = "content";
      if (!outputs.includes(prev.output)) next.output = "file";
      return next.scope === prev.scope && next.output === prev.output ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasFrame, hasSelection, outputs]);

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
        const opts = toPngOptions(settings, bounds, frame);
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
  }, [open, doc, settings, bounds, frame, tooLarge]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // An open popover (a colour picker, a menu) owns Escape; let it close
      // first and keep the dialog up.
      if (anyMenuOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  // Copying an image to the system clipboard is PNG-only in every browser that
  // supports it, so the chosen lossy format does not apply to this path.
  const doCopy = () => {
    if (!bounds || !canExport) return;
    const opts = toPngOptions(settings, bounds, frame);
    // The ClipboardItem must be constructed synchronously inside the click
    // handler (Safari drops the user gesture across an await), so hand it the
    // pending blob rather than an awaited one.
    const blob = exportPng(doc, { ...opts, mimeType: "image/png", quality: undefined });
    navigator.clipboard
      .write([new ClipboardItem({ "image/png": blob })])
      .then(() => {
        notify.success("Copied the image to the clipboard.");
        onClose();
      })
      .catch((err: unknown) => {
        notify.error(err instanceof Error ? err.message : String(err));
      });
  };

  // Human-readable base name per scope; drives the asset name, the (slugified)
  // download filename and the shared file's name.
  const exportBaseName = () =>
    settings.scope === "frame" && frame
      ? frame.name
      : settings.scope === "selection"
      ? (selection.length === 1
          ? doc.nodes[selection[0]]?.name ?? "Selection"
          : "Selection")
      : doc.metadata.name || "Drawing";

  /**
   * Hand the image to the OS share sheet — the natural "save" on iPadOS/Android,
   * where a download link has no usable destination picker. `share()` cannot take
   * a pending blob, so rendering has to finish first; when that costs the user
   * gesture the browser rejects with NotAllowedError and we fall back to a
   * download rather than leaving the user with nothing.
   */
  const doShare = async (blob: Blob, baseName: string): Promise<boolean> => {
    const filename = exportFilename(settings, fileSlug(baseName));
    const file = new File([blob], filename, {
      type: FORMAT_INFO[settings.format].mimeType,
    });
    if (!navigator.canShare?.({ files: [file] })) {
      downloadBlob(blob, filename);
      return true;
    }
    try {
      await navigator.share({ files: [file], title: baseName });
      return true;
    } catch (err) {
      // Dismissing the sheet is not a failure — keep the dialog open.
      if (err instanceof DOMException && err.name === "AbortError") return false;
      downloadBlob(blob, filename);
      notify.info("Sharing was unavailable — downloaded the file instead.");
      return true;
    }
  };

  const doExport = async (destination: Exclude<ExportOutput, "clipboard">) => {
    if (!bounds || !canExport) return;
    try {
      const blob = await exportPng(doc, toPngOptions(settings, bounds, frame));
      const baseName = exportBaseName();
      if (destination === "asset") {
        await addImageAsset(blob, baseName, FORMAT_INFO[settings.format].mimeType);
      } else if (destination === "share") {
        if (!(await doShare(blob, baseName))) return;
      } else {
        downloadBlob(blob, exportFilename(settings, fileSlug(baseName)));
      }
      onClose();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : String(err));
    }
  };

  // The clipboard path stays synchronous up to the ClipboardItem, so it cannot
  // share doExport's await-then-dispatch shape.
  const confirm = () => {
    if (settings.output === "clipboard") doCopy();
    else void doExport(settings.output);
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
              {settings.sizeMode === "scale" && (
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
              )}
            </div>
          </div>

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
              <ColorInput
                className="export-swatch"
                value={settings.background}
                disabled={canTransparent && settings.transparent}
                onChange={(hex) => update({ background: hex })}
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

          {/* Last row: the destination sits next to the button that acts on it. */}
          <div className="pref-row">
            <div className="pref-text">
              <span className="pref-title">Output</span>
            </div>
            <div className="pref-control">
              <div className="pref-segmented" role="group" aria-label="Output">
                {outputs.map((output) => (
                  <button
                    key={output}
                    type="button"
                    className={
                      "pref-seg" + (settings.output === output ? " active" : "")
                    }
                    aria-pressed={settings.output === output}
                    title={OUTPUT_HINTS[output]}
                    onClick={() => update({ output })}
                  >
                    {OUTPUT_LABELS[output]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className={"export-dims" + (tooLarge ? " over" : "")}>
            {dims ? `${dims.width} × ${dims.height} px` : ""}
          </span>
          <button
            type="button"
            className="preferences-button primary"
            disabled={!canExport}
            onClick={confirm}
          >
            {OUTPUT_ACTIONS[settings.output]}
          </button>
        </div>
      </div>
    </div>
  );
}
