const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** HSV with `h` in degrees [0, 360) and `s`/`v` in [0, 1]. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** Parse `#rgb`/`#rrggbb` to 0-255 channels (black on malformed input). */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.trim().replace("#", "").toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** `rgba()` string for a `#rrggbb` colour plus a separate 0..1 alpha. */
export function rgba(color: string, alpha: number): string {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Colour space a blend between two colours is computed in. `srgb` is the plain
 * channel-wise mix every renderer does natively; `oklab` is perceptually even
 * (no muddy midpoint between complements) and has to be sampled by hand — see
 * {@link mixHex} and the stop expansion in `gradient.ts`.
 */
export type InterpolationSpace = "srgb" | "oklab";

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const linearToSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** Linear-light sRGB to Oklab (Björn Ottosson's matrices). */
function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Oklab back to linear-light sRGB. */
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Blend two `#rrggbb` colours at `t` (0..1) in the given space. */
export function mixHex(a: string, b: string, t: number, space: InterpolationSpace): string {
  const u = clamp01(t);
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (space === "srgb") {
    return rgbToHex(
      ca.r + (cb.r - ca.r) * u,
      ca.g + (cb.g - ca.g) * u,
      ca.b + (cb.b - ca.b) * u
    );
  }
  const la = linearToOklab(
    srgbToLinear(ca.r / 255), srgbToLinear(ca.g / 255), srgbToLinear(ca.b / 255)
  );
  const lb = linearToOklab(
    srgbToLinear(cb.r / 255), srgbToLinear(cb.g / 255), srgbToLinear(cb.b / 255)
  );
  const [r, g, bl] = oklabToLinear(
    la[0] + (lb[0] - la[0]) * u,
    la[1] + (lb[1] - la[1]) * u,
    la[2] + (lb[2] - la[2]) * u
  );
  return rgbToHex(
    linearToSrgb(clamp01(r)) * 255,
    linearToSrgb(clamp01(g)) * 255,
    linearToSrgb(clamp01(bl)) * 255
  );
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
