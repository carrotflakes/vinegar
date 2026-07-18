// Thin wrapper over the Fullscreen API with WebKit fallbacks (older Safari
// still ships the webkit-prefixed calls). Kept DOM-only so both the command
// registry and the header button can share it.

interface WebkitDocument {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}
interface WebkitElement {
  webkitRequestFullscreen?: () => void;
}

export function isFullscreen(): boolean {
  const doc = document as Document & WebkitDocument;
  return (doc.fullscreenElement ?? doc.webkitFullscreenElement) != null;
}

export function toggleFullscreen(): void {
  const doc = document as Document & WebkitDocument;
  if (isFullscreen()) {
    (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc);
  } else {
    const el = document.documentElement as HTMLElement & WebkitElement;
    (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
  }
}
