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

/**
 * True when the app runs as an installed PWA (standalone / fullscreen display
 * mode). There is no browser chrome to escape then, so the fullscreen toggle
 * has nothing to do and is hidden.
 */
export function isStandaloneDisplay(): boolean {
  // iOS Safari never matched the display-mode query for home-screen apps.
  if ((navigator as Navigator & { standalone?: boolean }).standalone) return true;
  if (typeof matchMedia !== "function") return false;
  return ["standalone", "fullscreen"].some(
    (mode) => matchMedia(`(display-mode: ${mode})`).matches,
  );
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
