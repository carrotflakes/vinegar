import { useEffect, useReducer } from "react";
import {
  getAssetImage,
  subscribeImageCache,
} from "../../../imageCache";
import type {
  DocumentAsset,
  ImageShape,
} from "../../../model/types";
import { useEditor } from "../../../store/editorStore";

export default function ImageSection({
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
