/**
 * The editor's font catalogue.
 *
 * A *bundled* font ships as a WOFF in `public/fonts/` and is the only kind that
 * can be outlined: glyph geometry needs the font binary, and the browser gives
 * no way to read outlines out of `fillText`. Because the same file backs both
 * the `@font-face` the canvas paints with (see `fontFaces.ts`) and the parse
 * that produces outlines, the painted text and its geometry cannot drift apart.
 *
 * A *system* font has no `files`: it is a CSS stack resolved by the browser, so
 * it still paints and measures, but has no outlines. Legacy documents naming
 * one keep working unchanged.
 */

export interface FontFile {
  weight: number;
  italic: boolean;
  /** File name under `public/fonts/`. */
  file: string;
}

export interface FontOption {
  /** Stable display name; this is what `TextShape.fontFamily` persists. */
  name: string;
  /** CSS stack used for painting, measuring and the text editor overlay. */
  stack: string;
  /** Bundled outline sources. Empty for a system font. */
  files: readonly FontFile[];
  /**
   * Whether the service worker precaches the files. A large family is left out
   * so it is fetched on first use instead of on install — see the `globIgnores`
   * in `vite.config.ts`, which has to agree with this flag.
   */
  precached: boolean;
}

/** The four styles every bundled family ships: 400/700 x upright/italic. */
function faces(slug: string): readonly FontFile[] {
  return [
    { weight: 400, italic: false, file: `${slug}-400.woff` },
    { weight: 400, italic: true, file: `${slug}-400i.woff` },
    { weight: 700, italic: false, file: `${slug}-700.woff` },
    { weight: 700, italic: true, file: `${slug}-700i.woff` },
  ];
}

const SANS_FALLBACK = "system-ui, -apple-system, sans-serif";
const SERIF_FALLBACK = "ui-serif, Georgia, serif";
const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * Bundled first, system after. Arimo/Tinos/Cousine/Gelasio are the
 * metric-compatible open counterparts of Arial/Times/Courier/Georgia, so a
 * document can move to an outlineable font without relaying out.
 */
export const FONT_OPTIONS: readonly FontOption[] = [
  { name: "Inter", stack: `"Inter", ${SANS_FALLBACK}`, files: faces("inter"), precached: true },
  { name: "Source Serif", stack: `"Source Serif", ${SERIF_FALLBACK}`, files: faces("source-serif"), precached: true },
  { name: "JetBrains Mono", stack: `"JetBrains Mono", ${MONO_FALLBACK}`, files: faces("jetbrains-mono"), precached: true },
  { name: "Arimo", stack: `"Arimo", Arial, ${SANS_FALLBACK}`, files: faces("arimo"), precached: true },
  { name: "Tinos", stack: `"Tinos", "Times New Roman", ${SERIF_FALLBACK}`, files: faces("tinos"), precached: true },
  { name: "Cousine", stack: `"Cousine", "Courier New", ${MONO_FALLBACK}`, files: faces("cousine"), precached: true },
  { name: "Gelasio", stack: `"Gelasio", Georgia, ${SERIF_FALLBACK}`, files: faces("gelasio"), precached: true },
  // Japanese: ~1.4 MB per weight, and italic would be synthesised anyway.
  {
    name: "Noto Sans JP",
    stack: `"Noto Sans JP", ${SANS_FALLBACK}`,
    files: [
      { weight: 400, italic: false, file: "noto-sans-jp-400.woff" },
      { weight: 700, italic: false, file: "noto-sans-jp-700.woff" },
    ],
    precached: false,
  },
  { name: "System Sans", stack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`, files: [], precached: false },
  { name: "System Serif", stack: `ui-serif, Georgia, "Times New Roman", serif`, files: [], precached: false },
  { name: "System Mono", stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, files: [], precached: false },
  { name: "Arial", stack: `Arial, sans-serif`, files: [], precached: false },
  { name: "Georgia", stack: `Georgia, serif`, files: [], precached: false },
  { name: "Times New Roman", stack: `"Times New Roman", Times, serif`, files: [], precached: false },
  { name: "Verdana", stack: `Verdana, sans-serif`, files: [], precached: false },
  { name: "Trebuchet MS", stack: `"Trebuchet MS", sans-serif`, files: [], precached: false },
  { name: "Courier New", stack: `"Courier New", monospace`, files: [], precached: false },
] as const;

/** The default for newly created text: a bundled family, so it can be outlined. */
export const DEFAULT_FONT_FAMILY = "Inter";

export function fontOption(name: string): FontOption | undefined {
  return FONT_OPTIONS.find((option) => option.name === name);
}

export function fontStack(name: string): string {
  return fontOption(name)?.stack ??
    `"${name.replace(/["\\]/g, "")}", sans-serif`;
}

/** Where a bundled file is served from. */
export function fontFileUrl(file: string): string {
  return `${import.meta.env.BASE_URL}fonts/${file}`;
}

/**
 * The bundled face a shape's style resolves to, or `null` for a system font.
 * Weight selection follows the CSS font-matching order — below 400 prefer
 * lighter faces first, at or above 400 prefer heavier — so the file we outline
 * from is the one the browser paints with. An italic request falls back to the
 * upright face (the browser synthesises the slant, and so must the outline
 * consumer) when the family ships no italic.
 */
export function fontFileFor(
  family: string,
  weight: number,
  italic: boolean
): FontFile | null {
  const option = fontOption(family);
  if (!option || option.files.length === 0) return null;
  const styled = option.files.filter((file) => file.italic === italic);
  const candidates = styled.length > 0
    ? styled
    : option.files.filter((file) => !file.italic);
  let best: FontFile | null = null;
  for (const file of candidates) {
    if (best === null) { best = file; continue; }
    if (weightRank(file.weight, weight) < weightRank(best.weight, weight)) best = file;
  }
  return best;
}

/** Lower is a better match for `desired`; ties never happen (weights differ). */
function weightRank(weight: number, desired: number): number {
  const distance = Math.abs(weight - desired);
  const preferred = desired < 400 ? weight <= desired : weight >= desired;
  return (preferred ? 0 : 1000) + distance;
}
