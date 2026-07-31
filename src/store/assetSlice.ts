// Document assets (imported images) and placing imported artwork — image files,
// SVG, or an asset already in the document — into the scene.

import { unionNodeWorldBounds } from "@/model/geometry/bounds";
import { multiply, translation } from "@/model/geometry/matrix";
import { referencedAssetIds } from "../model/scene";
import { baseNodeDefaults, baseShapeDefaults, makeId, type DocumentAsset, type ImageShape } from "../model/types";
import { blobToDataUrl, importImageFile, importImageFiles, isImageFile } from "../io/importImage";
import { loadAssetImage } from "../imageCache";
import { notify } from "./toastStore";
import { appendToScope } from "./docOps";
import {
  clearTransient,
  currentFocusRoot,
  type AssetActions,
  type StoreCtx,
} from "./state";

/** Shown when picked/dropped image files can't be read or decoded. */
const IMAGE_LOAD_ERROR =
  "Could not load the image. It may be corrupt or an unsupported format.";

/** Human-readable byte size (e.g. "1.2 MB") for toast/asset weight reporting. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createAssetActions({ set, get, transact }: StoreCtx): AssetActions {
  return {
    placeImageFiles: async (files, at, fitWithin) => {
      const images = await importImageFiles(files);
      if (!images.length) {
        if (files.some(isImageFile)) notify.error(IMAGE_LOAD_ERROR);
        return;
      }
      const s = get();
      const nodes = { ...s.doc.nodes };
      const assets = { ...s.doc.assets };
      const ids: string[] = [];
      // Multiple files land as a small cascade so none hides the others.
      images.forEach((img, i) => {
        const scale = fitWithin
          ? Math.min(1, fitWithin.width / img.naturalWidth, fitWithin.height / img.naturalHeight)
          : 1;
        const width = img.naturalWidth * scale;
        const height = img.naturalHeight * scale;
        const shape: ImageShape = {
          id: makeId("image"),
          name: img.asset.name?.replace(/\.[^.]+$/, "") || "Image",
          type: "image",
          assetId: img.asset.id,
          x: at.x - width / 2 + i * 24,
          y: at.y - height / 2 + i * 24,
          width,
          height,
          ...baseNodeDefaults(),
          ...baseShapeDefaults(),
          lockAspect: false,
          transform: [1, 0, 0, 1, 0, 0],
        };
        assets[img.asset.id] = img.asset;
        nodes[shape.id] = shape;
        ids.push(shape.id);
      });
      const doc = { ...s.doc, nodes, assets };
      const next = appendToScope(doc, currentFocusRoot(s), ids);
      if (!next) return;
      transact(next, { label: ids.length === 1 ? "Place image" : `Place ${ids.length} images` });
      set({ selection: ids, ...clearTransient });
    },
    placeImportedSvg: (imported, at, fitWithin) => {
      const s = get();
      const root = imported.nodes[imported.rootId];
      if (!root) return;
      const preview = {
        ...s.doc,
        nodes: { ...s.doc.nodes, ...imported.nodes },
        rootIds: [imported.rootId],
      };
      const bounds = unionNodeWorldBounds(preview, [imported.rootId]);
      if (!bounds) return;
      const scale = fitWithin
        ? Math.min(
            1,
            bounds.width > 0 ? fitWithin.width / bounds.width : 1,
            bounds.height > 0 ? fitWithin.height / bounds.height : 1
          )
        : 1;
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      const placement = multiply(
        translation(at.x, at.y),
        multiply(
          [scale, 0, 0, scale, 0, 0],
          translation(-centerX, -centerY)
        )
      );
      const nodes = {
        ...s.doc.nodes,
        ...imported.nodes,
        [root.id]: {
          ...root,
          transform: multiply(placement, root.transform),
        },
      };
      const doc = appendToScope(
        { ...s.doc, nodes },
        currentFocusRoot(s),
        [root.id]
      );
      if (!doc) return;
      transact(doc, { label: "Place SVG" });
      set({ selection: [root.id], ...clearTransient });
    },
    addPatternImage: async (file) => {
      if (!isImageFile(file)) return null;
      const img = await importImageFile(file);
      if (!img) {
        notify.error(IMAGE_LOAD_ERROR);
        return null;
      }
      const s = get();
      transact({ ...s.doc, assets: { ...s.doc.assets, [img.asset.id]: img.asset } }, { label: "Add image asset" });
      return img.asset.id;
    },
    importImageAssets: async (files) => {
      const images = await importImageFiles(files);
      if (!images.length) {
        if (files.some(isImageFile)) notify.error(IMAGE_LOAD_ERROR);
        return [];
      }
      const s = get();
      const assets = { ...s.doc.assets };
      const ids: string[] = [];
      images.forEach((img) => {
        assets[img.asset.id] = img.asset;
        ids.push(img.asset.id);
      });
      transact({ ...s.doc, assets }, { label: images.length === 1 ? "Import image asset" : `Import ${images.length} image assets` });
      return ids;
    },
    addImageAsset: async (blob, name, mimeType) => {
      const data = await blobToDataUrl(blob);
      if (!data) {
        notify.error(IMAGE_LOAD_ERROR);
        return null;
      }
      const s = get();
      // Re-use an identical asset rather than piling up duplicate copies of the
      // same pixels — repeated exports of an unchanged region are common.
      const existing = Object.values(s.doc.assets).find(
        (a) => a.source.type === "data" && a.source.data === data
      );
      if (existing) {
        notify.success("Already in assets");
        return existing.id;
      }
      const asset: DocumentAsset = {
        id: makeId("asset"),
        kind: "image",
        mimeType,
        name,
        source: { type: "data", data },
      };
      transact(
        { ...s.doc, assets: { ...s.doc.assets, [asset.id]: asset } },
        { label: "Export to asset" }
      );
      // Assets embed in the document, so surface the weight it adds on save.
      notify.success(`Added to assets · ${formatBytes(blob.size)}`);
      return asset.id;
    },
    placeAssetImage: async (assetId, at, fitWithin) => {
      const asset = get().doc.assets[assetId];
      if (!asset) return;
      // Natural size drives the placed box; await a decode so it isn't guessed.
      const img = await loadAssetImage(asset);
      const natW = img && img.naturalWidth > 0 ? img.naturalWidth : 100;
      const natH = img && img.naturalHeight > 0 ? img.naturalHeight : 100;
      const scale = fitWithin
        ? Math.min(1, fitWithin.width / natW, fitWithin.height / natH)
        : 1;
      const width = natW * scale;
      const height = natH * scale;
      const s = get();
      if (!s.doc.assets[assetId]) return; // deleted while decoding
      const shape: ImageShape = {
        id: makeId("image"),
        name: asset.name?.replace(/\.[^.]+$/, "") || "Image",
        type: "image",
        assetId,
        x: at.x - width / 2,
        y: at.y - height / 2,
        width,
        height,
        ...baseNodeDefaults(),
        ...baseShapeDefaults(),
        lockAspect: false,
        transform: [1, 0, 0, 1, 0, 0],
      };
      const doc = { ...s.doc, nodes: { ...s.doc.nodes, [shape.id]: shape } };
      const next = appendToScope(doc, currentFocusRoot(s), [shape.id]);
      if (!next) return;
      transact(next, { label: "Place image" });
      set({ selection: [shape.id], ...clearTransient });
    },
    deleteAsset: (assetId) => {
      const doc = get().doc;
      if (!doc.assets[assetId] || referencedAssetIds(doc).has(assetId)) return;
      const assets = { ...doc.assets }; delete assets[assetId];
      transact({ ...doc, assets }, { label: "Delete asset" });
    },
    deleteUnusedAssets: () => {
      const doc = get().doc;
      const used = referencedAssetIds(doc);
      const assets = { ...doc.assets };
      let removed = 0;
      for (const id of Object.keys(assets)) if (!used.has(id)) { delete assets[id]; removed++; }
      if (removed) transact({ ...doc, assets }, { label: removed === 1 ? "Delete unused asset" : `Delete ${removed} unused assets` });
      return removed;
    },
  };
}
