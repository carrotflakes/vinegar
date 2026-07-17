import { useEffect, useMemo, useReducer } from "react";
import { LuImage, LuTrash2 } from "react-icons/lu";
import { getAssetImage, subscribeImageCache } from "../canvas/imageCache";
import { assetReferenceCounts } from "../model/scene";
import { useEditor } from "../store/editorStore";
import "./Panel.css";
import "./LayersPanel.css";
import "./AssetsPanel.css";

/**
 * A read-only view of the document's embedded binary assets (raster images).
 * Mirrors the Symbols panel so it can live in its own dock tab: each row shows
 * a thumbnail, name, format and how many shapes reference the asset.
 */
export default function AssetsPanel() {
  const doc = useEditor((s) => s.doc);
  const deleteAsset = useEditor((s) => s.deleteAsset);
  const deleteUnusedAssets = useEditor((s) => s.deleteUnusedAssets);
  // Thumbnails decode asynchronously; repaint when any asset's pixels arrive.
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribeImageCache(bump), []);

  const assets = Object.values(doc.assets);
  // Reference counts, keyed on `doc`, so image-decode repaints (which bump this
  // component without changing `doc`) reuse the result instead of rescanning.
  const counts = useMemo(() => assetReferenceCounts(doc), [doc]);
  const unusedCount = assets.filter((a) => !counts.has(a.id)).length;

  return (
    <div className="symbols-panel">
      <div className="panel-title layers-title">
        <span>Assets</span>
        <button
          className="assets-purge"
          disabled={unusedCount === 0}
          title={
            unusedCount > 0
              ? `Remove ${unusedCount} unused asset${unusedCount > 1 ? "s" : ""}`
              : "No unused assets"
          }
          onClick={() => deleteUnusedAssets()}
        >
          Remove unused
        </button>
      </div>
      <div className="symbols-list">
        {assets.length === 0 ? (
          <div className="layers-empty">No assets yet</div>
        ) : (
          assets.map((asset) => {
            const img = getAssetImage(asset);
            const count = counts.get(asset.id) ?? 0;
            const format = asset.mimeType.replace(/^image\//, "").toUpperCase();
            const dims =
              img && img.naturalWidth > 0
                ? `${img.naturalWidth}×${img.naturalHeight}`
                : "";
            const unused = !counts.has(asset.id);
            return (
              <div key={asset.id} className="asset-row">
                <span className="asset-thumb" aria-hidden>
                  {img ? (
                    <img src={asset.source.data} alt="" />
                  ) : (
                    <LuImage />
                  )}
                </span>
                <span className="asset-info">
                  <span className="asset-name" title={asset.name}>
                    {asset.name || "Untitled"}
                  </span>
                  <span className="asset-meta">
                    {[format, dims].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span
                  className="layer-count"
                  title={unused ? "Not used by any shape" : `Used ${count}×`}
                >
                  {unused ? "unused" : count}
                </span>
                <button
                  className="layer-icon-btn"
                  title={
                    unused ? "Delete asset" : "Delete (remove referencing shapes first)"
                  }
                  disabled={!unused}
                  onClick={() => deleteAsset(asset.id)}
                >
                  <LuTrash2 />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
