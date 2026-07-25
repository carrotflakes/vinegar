import { hexToRgb } from "./paint";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** HSV with `h` in degrees [0, 360) and `s`/`v` in [0, 1]. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** 0-255 channels to `#rrggbb` (channels are rounded and clamped). */
export function rgbToHex(r: number, g: number, b: number): string {
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Normalize user-entered hex (`#rgb`, `rrggbb`…) to `#rrggbb`, or null if it
 * isn't a colour. */
export function normalizeHex(input: string): string | null {
  let v = input.trim().toLowerCase();
  if (!v.startsWith("#")) v = "#" + v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    v = "#" + v.slice(1).split("").map((c) => c + c).join("");
  }
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

/** `#rgb`/`#rrggbb` to HSV. Hue is 0 for grays, which have none. */
export function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** HSV to 0-255 channels. */
export function hsvToRgb({ h, s, v }: Hsv): { r: number; g: number; b: number } {
  const hh = ((h % 360) + 360) % 360;
  const c = clamp01(v) * clamp01(s);
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = clamp01(v) - c;
  const sector = Math.floor(hh / 60) % 6;
  const [r, g, b] =
    sector === 0
      ? [c, x, 0]
      : sector === 1
        ? [x, c, 0]
        : sector === 2
          ? [0, c, x]
          : sector === 3
            ? [0, x, c]
            : sector === 4
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** HSV to `#rrggbb`. */
export function hsvToHex(hsv: Hsv): string {
  const { r, g, b } = hsvToRgb(hsv);
  return rgbToHex(r, g, b);
}
