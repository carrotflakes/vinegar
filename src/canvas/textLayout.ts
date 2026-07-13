import type { TextShape } from "../model/types";
import { fontStack } from "../ui/fonts";

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

/**
 * Vertical font metrics, in px, used to place the baseline the same way a
 * browser lays a line box out — so the canvas/SVG render and the HTML text
 * editor overlay agree. Defaults approximate a 0.8/0.2 ascent split.
 */
export interface TextFontMetrics {
  ascent: number;
  descent: number;
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
  metrics?: TextFontMetrics
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
  const ascent = metrics?.ascent ?? shape.fontSize * 0.8;
  const descent = metrics?.descent ?? shape.fontSize * 0.2;
  const lineBox = shape.fontSize * shape.lineHeight;
  const height = Math.max(1, rawLines.length) * lineBox;
  // Match the browser's line-box model: centre the ascent+descent band inside
  // the line box, then drop to the baseline. Keeps the render aligned with the
  // HTML text-editor overlay.
  const baselineInset = (lineBox - (ascent + descent)) / 2 + ascent;
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

/**
 * Read the active font's vertical metrics from a measuring context, falling
 * back to the 0.8/0.2 approximation when `fontBoundingBox*` is unavailable
 * (older engines, the SSR/test path). The probe string is irrelevant: these
 * are font-wide metrics, not per-glyph.
 */
function contextFontMetrics(
  ctx: Pick<CanvasRenderingContext2D, "measureText">,
  fontSize: number
): TextFontMetrics {
  const m = ctx.measureText("Mg");
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  if (typeof ascent === "number" && typeof descent === "number" && ascent + descent > 0) {
    return { ascent, descent };
  }
  return { ascent: fontSize * 0.8, descent: fontSize * 0.2 };
}

let measuringContext: CanvasRenderingContext2D | null = null;

function browserMeasurer(shape: TextShape): { measure: MeasureTextWidth; metrics?: TextFontMetrics } {
  if (!measuringContext && typeof document !== "undefined") {
    measuringContext = document.createElement("canvas").getContext("2d");
  }
  if (measuringContext) {
    measuringContext.font = textFontCss(shape);
    return {
      measure: (text) => measuringContext!.measureText(text).width,
      metrics: contextFontMetrics(measuringContext, shape.fontSize),
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
    contextFontMetrics(ctx, shape.fontSize)
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
