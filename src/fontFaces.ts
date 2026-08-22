import { FONT_OPTIONS, fontFileUrl } from "./fonts";

let registered = false;

/**
 * Declare every bundled face to the browser. `FontFace` fetches lazily — a
 * family is only downloaded once something is painted with it — so registering
 * the whole catalogue at startup costs nothing; what the service worker does or
 * does not precache (`FontOption.precached`) decides what is available offline.
 */
export function registerBundledFonts(): void {
  if (registered) return;
  if (typeof document === "undefined" || !document.fonts) return;
  registered = true;
  for (const option of FONT_OPTIONS) {
    for (const file of option.files) {
      const face = new FontFace(
        option.name,
        `url("${fontFileUrl(file.file)}") format("woff")`,
        {
          weight: String(file.weight),
          style: file.italic ? "italic" : "normal",
          display: "swap",
        }
      );
      document.fonts.add(face);
    }
  }
}
