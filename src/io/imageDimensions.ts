import type { DocumentAsset } from "../model/types";

export interface ImageSize {
  width: number;
  height: number;
}

export function validImageSize(
  width: number,
  height: number
): ImageSize | null {
  return Number.isFinite(width) && width > 0 &&
    Number.isFinite(height) && height > 0
    ? { width, height }
    : null;
}

/** Read intrinsic dimensions from an embedded image without decoding pixels. */
export function embeddedImageSize(asset: DocumentAsset): ImageSize | null {
  const source = decodeDataUrl(asset.source.data);
  if (!source) return null;
  if (asset.mimeType === "image/svg+xml") {
    return svgIntrinsicSize(source.text);
  }
  return rasterIntrinsicSize(source.bytes);
}

function decodeDataUrl(dataUrl: string): {
  bytes: Uint8Array;
  text: string;
} | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  const metadata = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  try {
    const text = metadata.split(";").includes("base64")
      ? atob(payload)
      : decodeURIComponent(payload);
    return {
      bytes: Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff),
      text,
    };
  } catch {
    return null;
  }
}

const u16be = (bytes: Uint8Array, at: number) =>
  bytes[at] * 0x100 + bytes[at + 1];
const u16le = (bytes: Uint8Array, at: number) =>
  bytes[at] + bytes[at + 1] * 0x100;
const u24le = (bytes: Uint8Array, at: number) =>
  bytes[at] + bytes[at + 1] * 0x100 + bytes[at + 2] * 0x10000;
const u32be = (bytes: Uint8Array, at: number) =>
  bytes[at] * 0x1000000 +
  bytes[at + 1] * 0x10000 +
  bytes[at + 2] * 0x100 +
  bytes[at + 3];
const u32le = (bytes: Uint8Array, at: number) =>
  bytes[at] +
  bytes[at + 1] * 0x100 +
  bytes[at + 2] * 0x10000 +
  bytes[at + 3] * 0x1000000;
const i32le = (bytes: Uint8Array, at: number) => {
  const value = u32le(bytes, at);
  return value > 0x7fffffff ? value - 0x100000000 : value;
};

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.slice(at, at + length));
}

function rasterIntrinsicSize(bytes: Uint8Array): ImageSize | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG"
  ) {
    return validImageSize(u32be(bytes, 16), u32be(bytes, 20));
  }
  if (
    bytes.length >= 10 &&
    (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")
  ) {
    return validImageSize(u16le(bytes, 6), u16le(bytes, 8));
  }
  if (bytes.length >= 26 && ascii(bytes, 0, 2) === "BM") {
    return validImageSize(
      Math.abs(i32le(bytes, 18)),
      Math.abs(i32le(bytes, 22))
    );
  }
  if (
    bytes.length >= 30 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    const kind = ascii(bytes, 12, 4);
    if (kind === "VP8X") {
      return validImageSize(
        u24le(bytes, 24) + 1,
        u24le(bytes, 27) + 1
      );
    }
    if (
      kind === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return validImageSize(
        u16le(bytes, 26) & 0x3fff,
        u16le(bytes, 28) & 0x3fff
      );
    }
    if (kind === "VP8L" && bytes[20] === 0x2f) {
      const b1 = bytes[21];
      const b2 = bytes[22];
      const b3 = bytes[23];
      const b4 = bytes[24];
      return validImageSize(
        1 + b1 + ((b2 & 0x3f) << 8),
        1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)
      );
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 8 < bytes.length) {
      if (bytes[at] !== 0xff) {
        at += 1;
        continue;
      }
      const marker = bytes[at + 1];
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return validImageSize(u16be(bytes, at + 7), u16be(bytes, at + 5));
      }
      if (marker === 0xd8 || marker === 0xd9) {
        at += 2;
        continue;
      }
      const length = u16be(bytes, at + 2);
      if (length < 2) break;
      at += length + 2;
    }
  }
  return null;
}

function svgIntrinsicSize(svg: string): ImageSize | null {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!root) return null;
  const length = (name: string) => {
    const match = root.match(
      new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, "i")
    );
    return match ? Number(match[1]) : null;
  };
  const width = length("width");
  const height = length("height");
  if (width && height) return validImageSize(width, height);
  const viewBox = root
    .match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!viewBox || viewBox.length !== 4) return null;
  const ratio = viewBox[2] / viewBox[3];
  return validImageSize(
    width ?? (height ? height * ratio : viewBox[2]),
    height ?? (width ? width / ratio : viewBox[3])
  );
}
