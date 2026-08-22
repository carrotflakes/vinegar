import type { Document, TextShape } from "../types";
import { isShape } from "../scene";
import { fontStack } from "@/fonts";
import { notifyFontsChanged } from "@/fontCache";
import { renderCachesDisabled } from "@/debug/renderFlags";

export interface TextLineLayout {
  text: string;
  /** Horizontal offset from the text shape's x. */
  x: number;
  /** Alphabetic baseline offset from the text shape's y. */
  baseline: number;
  width: number;
}

export interface TextLayout {
  lines: TextLineLayout[];
  width: number;
  height: number;
}

export type MeasureTextWidth = (text: string) => number;

/** Alphabetic baseline offset from the top of the first CSS line box. */
export interface TextBaselineMetrics {
  baseline: number;
}

const CJK = /[\u2e80-\u2fff\u3000-\u303f\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/u;

function tokensForWrap(text: string): string[] {
  const tokens: string[] = [];
  let latin = "";
  let spaces = "";
  const flushLatin = () => {
    if (latin) tokens.push(latin);
    latin = "";
  };
  const flushSpaces = () => {
    if (spaces) tokens.push(spaces);
    spaces = "";
  };
  for (const char of Array.from(text)) {
    if (/\s/u.test(char)) {
      flushLatin();
      spaces += char;
    } else if (CJK.test(char)) {
      flushLatin();
      flushSpaces();
      tokens.push(char);
    } else {
      flushSpaces();
      latin += char;
    }
  }
  flushLatin();
  flushSpaces();
  return tokens;
}

function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  measure: MeasureTextWidth
): string[] {
  if (paragraph === "") return [""];
  const lines: string[] = [];
  let line = "";
  const pushLine = () => {
    lines.push(line.trimEnd());
    line = "";
  };

  for (const token of tokensForWrap(paragraph)) {
    const whitespace = /^\s+$/u.test(token);
    if (whitespace && line === "") continue;
    const candidate = line + token;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (whitespace) {
      pushLine();
      continue;
    }
    if (line !== "") pushLine();
    if (measure(token) <= maxWidth) {
      line = token;
      continue;
    }
    // A token wider than the area is broken by Unicode code point. This is
    // also the fallback for long unspaced Latin strings.
    for (const char of Array.from(token)) {
      if (line && measure(line + char) > maxWidth) pushLine();
      line += char;
    }
  }
  if (line !== "" || lines.length === 0) pushLine();
  return lines;
}

/** Pure text layout; callers inject the active font's width measurement. */
export function layoutText(
  shape: Pick<TextShape, "text" | "textMode" | "width" | "fontSize" | "lineHeight" | "align">,
  measure: MeasureTextWidth,
  metrics?: TextBaselineMetrics | undefined
): TextLayout {
  const paragraphs = shape.text.replace(/\r\n?/g, "\n").split("\n");
  const rawLines = shape.textMode === "area"
    ? paragraphs.flatMap((paragraph) => wrapParagraph(paragraph, Math.max(1, shape.width), measure))
    : paragraphs;
  const widths = rawLines.map(measure);
  const measuredWidth = widths.reduce((max, width) => Math.max(max, width), 0);
  const width = shape.textMode === "area"
    ? Math.max(1, shape.width)
    : Math.max(shape.fontSize * 0.5, measuredWidth);
  const lineBox = shape.fontSize * shape.lineHeight;
  const height = Math.max(1, rawLines.length) * lineBox;
  // The fallback approximates an 0.8em ascent with half-leading. Browser
  // rendering uses a measured CSS baseline instead (see browserBaseline).
  const baselineInset = metrics?.baseline ??
    (lineBox - shape.fontSize) / 2 + shape.fontSize * 0.8;
  return {
    width,
    height,
    lines: rawLines.map((text, index) => {
      const lineWidth = widths[index];
      const x = shape.align === "center"
        ? (width - lineWidth) / 2
        : shape.align === "right"
          ? width - lineWidth
          : 0;
      return { text, width: lineWidth, x, baseline: index * lineBox + baselineInset };
    }),
  };
}

export function textFontCss(shape: Pick<TextShape, "italic" | "fontWeight" | "fontSize" | "fontFamily">): string {
  return `${shape.italic ? "italic " : ""}${shape.fontWeight} ${shape.fontSize}px ${fontStack(shape.fontFamily)}`;
}

let measuringContext: CanvasRenderingContext2D | null = null;
const baselineCache = new Map<string, number>();
let layoutCache = new WeakMap<TextShape, TextLayout>();

/**
 * Measure the baseline from the same CSS inline-formatting context used by the
 * textarea editor. Canvas TextMetrics are deliberately not used here:
 * `fontBoundingBox*` does not have to use the same ascent/descent metrics as
 * CSS, especially when a font stack falls back for CJK glyphs.
 */
function browserBaseline(shape: TextShape): TextBaselineMetrics | undefined {
  if (typeof document === "undefined" || !document.body) return undefined;
  const lineBox = shape.fontSize * shape.lineHeight;
  const font = textFontCss(shape);
  const key = `${font}\n${lineBox}`;
  const cached = baselineCache.get(key);
  if (cached !== undefined) return { baseline: cached };

  const probe = document.createElement("div");
  const marker = document.createElement("span");
  Object.assign(probe.style, {
    position: "absolute",
    left: "-10000px",
    top: "0",
    visibility: "hidden",
    pointerEvents: "none",
    margin: "0",
    padding: "0",
    border: "0",
    font,
    lineHeight: `${lineBox}px`,
    whiteSpace: "nowrap",
  });
  Object.assign(marker.style, {
    display: "inline-block",
    width: "0",
    height: "0",
    margin: "0",
    padding: "0",
    border: "0",
    verticalAlign: "baseline",
  });
  probe.append(document.createTextNode("M"), marker);
  document.body.append(probe);
  const baseline = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  if (!Number.isFinite(baseline)) return undefined;
  baselineCache.set(key, baseline);
  return { baseline };
}

/**
 * Clear measurements after the browser reports that available fonts changed.
 * Glyph outlines are *placed* by these measurements — a line's x offset and an
 * area text's wrapping both come from them — so anything derived from text has
 * to go with them, or outlines laid out against fallback metrics would stay on
 * screen for every shape whose measured box happened not to change.
 */
export function clearTextLayoutMetricsCache(): void {
  baselineCache.clear();
  layoutCache = new WeakMap();
  notifyFontsChanged();
}

function browserMeasurer(shape: TextShape): { measure: MeasureTextWidth; metrics?: TextBaselineMetrics | undefined } {
  if (!measuringContext && typeof document !== "undefined") {
    measuringContext = document.createElement("canvas").getContext("2d");
  }
  if (measuringContext) {
    measuringContext.font = textFontCss(shape);
    return {
      measure: (text) => measuringContext!.measureText(text).width,
      metrics: browserBaseline(shape),
    };
  }
  // SSR/test fallback. Browser documents are remeasured once fonts are ready.
  return { measure: (text) => Array.from(text).length * shape.fontSize * 0.6 };
}

/** Recompute only the persisted measured bounds. */
export function measureTextShape(shape: TextShape): TextShape {
  const layout = layoutTextInBrowser(shape);
  return { ...shape, width: layout.width, height: layout.height };
}

/** True when real font metrics are available (a DOM to measure against). */
export function canMeasureText(): boolean {
  return typeof document !== "undefined" && !!document.body;
}

/**
 * Re-derive the persisted bounds of every text node in a document. Documents
 * written outside the editor — scripts, other tools, hand edits — can only
 * estimate width/height because they have no font metrics, which leaves
 * selection, hit testing and export disagreeing with what is painted. Applying
 * this on load heals them. Returns the same document when nothing moved.
 *
 * Callers that may run without font metrics must gate on `canMeasureText`
 * first, or the fallback estimate replaces bounds that were already right.
 */
export function remeasureDocumentText(
  doc: Document,
  measureShape: (shape: TextShape) => TextShape = measureTextShape
): Document {
  let nodes = doc.nodes;
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!isShape(node) || node.type !== "text") continue;
    const next = measureShape(node);
    if (next.width === node.width && next.height === node.height) continue;
    if (nodes === doc.nodes) nodes = { ...doc.nodes };
    nodes[id] = next;
  }
  return nodes === doc.nodes ? doc : { ...doc, nodes };
}

/**
 * The layout of a text shape as the browser measures it — the one measurement
 * everything shares, so painted glyphs, their outlines, the editor overlay and
 * SVG export cannot disagree about where a line sits. Text shapes are immutable,
 * so the cache is self-invalidating apart from a metrics change
 * (`clearTextLayoutMetricsCache`).
 */
export function layoutTextInBrowser(shape: TextShape): TextLayout {
  const cached = renderCachesDisabled ? undefined : layoutCache.get(shape);
  if (cached) return cached;
  const { measure, metrics } = browserMeasurer(shape);
  const layout = layoutText(shape, measure, metrics);
  if (!renderCachesDisabled) layoutCache.set(shape, layout);
  return layout;
}
