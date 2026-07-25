import type { TextShape } from "../model/types";
import { fontStack } from "../fonts";

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

/** Clear measurements after the browser reports that available fonts changed. */
export function clearTextLayoutMetricsCache(): void {
  baselineCache.clear();
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

export function layoutTextWithCanvas(
  ctx: CanvasRenderingContext2D,
  shape: TextShape
): TextLayout {
  ctx.font = textFontCss(shape);
  return layoutText(
    shape,
    (text) => ctx.measureText(text).width,
    browserBaseline(shape)
  );
}

/** Recompute only the persisted measured bounds. */
export function measureTextShape(shape: TextShape): TextShape {
  const layout = layoutTextInBrowser(shape);
  return { ...shape, width: layout.width, height: layout.height };
}

export function layoutTextInBrowser(shape: TextShape): TextLayout {
  const { measure, metrics } = browserMeasurer(shape);
  return layoutText(shape, measure, metrics);
}
