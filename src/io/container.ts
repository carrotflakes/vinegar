// The binary `.vinegar` container.
//
// The document model itself is unchanged — the container only changes how the
// same `VinegarFile` reaches the disk:
//
//   * the JSON body is deflated, which is where nearly all of the win is
//     (a 325 KB document body lands around 19 KB);
//   * image assets leave the JSON as raw bytes instead of base64 text inside a
//     data URL, dropping base64's 33% overhead on data that would not deflate.
//
// `.vinegar.json` remains a supported, human-readable form of exactly the same
// file (see `saveDocument.ts`); nothing here bumps `CURRENT_FILE_VERSION`,
// because the document schema is untouched. `CONTAINER_VERSION` versions the
// wrapper alone.
//
// Layout (little-endian):
//
//   0   4   magic "VNGR"
//   4   2   u16 container version
//   6   2   u16 reserved (0)
//   8   4   u32 body length, deflated
//   12  4   u32 blob count
//   16  4×n u32 blob lengths, in order
//   …       body: deflate-raw of the UTF-8 JSON
//   …       blobs: concatenated, in order
//
// In the body, every asset's `source` is replaced by a reference into the blob
// table; `rehydrateAssets` puts the data URLs back before the ordinary
// validator ever sees the document.

import {
  buildVinegarFile,
  parseDocument,
  parseVinegarFile,
  type VinegarFile,
} from "./serialize";
import type { Document, DocumentAsset } from "../model/types";

const MAGIC = "VNGR";
export const CONTAINER_VERSION = 1 as const;
const HEADER_BYTES = 16;

/** An asset's data URL, split out of the JSON body into the blob table. */
interface BlobSource {
  type: "blob";
  /** Index into the blob table. */
  index: number;
  /**
   * The data URL up to and including its comma, when the URL was base64 and
   * the blob therefore holds the decoded bytes. `null` means the blob holds
   * the whole data URL as UTF-8 — the form percent-encoded data URLs take,
   * which cannot be re-encoded byte for byte.
   */
  base64Prefix: string | null;
}

/** Whether `bytes` starts with the container magic (as opposed to JSON text). */
export function isContainer(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_BYTES) return false;
  return [...MAGIC].every((ch, i) => bytes[i] === ch.charCodeAt(0));
}

/** Encode a document as a `.vinegar` container. */
export async function encodeDocument(doc: Document): Promise<Uint8Array> {
  const file = buildVinegarFile(doc);
  const blobs: Uint8Array[] = [];
  const body: VinegarFile = {
    ...file,
    document: { ...file.document, assets: externalizeAssets(file.document.assets, blobs) },
  };

  const json = new TextEncoder().encode(JSON.stringify(body));
  const deflated = await deflateRaw(json);

  const total =
    HEADER_BYTES + blobs.length * 4 + deflated.length +
    blobs.reduce((sum, blob) => sum + blob.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i);
  view.setUint16(4, CONTAINER_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, deflated.length, true);
  view.setUint32(12, blobs.length, true);
  blobs.forEach((blob, i) => view.setUint32(HEADER_BYTES + i * 4, blob.length, true));

  let offset = HEADER_BYTES + blobs.length * 4;
  out.set(deflated, offset);
  offset += deflated.length;
  for (const blob of blobs) {
    out.set(blob, offset);
    offset += blob.length;
  }
  return out;
}

/** Decode a `.vinegar` container. Throws the same way `parseDocument` does. */
export async function decodeDocument(bytes: Uint8Array): Promise<Document> {
  if (!isContainer(bytes)) throw new Error("Not a Vinegar file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== CONTAINER_VERSION) {
    throw new Error(`Unsupported Vinegar container version: ${version}.`);
  }
  const bodyLength = view.getUint32(8, true);
  const blobCount = view.getUint32(12, true);

  let offset = HEADER_BYTES + blobCount * 4;
  const lengths: number[] = [];
  for (let i = 0; i < blobCount; i++) {
    lengths.push(view.getUint32(HEADER_BYTES + i * 4, true));
  }
  const expected =
    offset + bodyLength + lengths.reduce((sum, length) => sum + length, 0);
  if (expected !== bytes.length) throw new Error("Vinegar file is truncated or corrupt.");

  const body = bytes.subarray(offset, offset + bodyLength);
  offset += bodyLength;
  const blobs = lengths.map((length) => {
    const blob = bytes.subarray(offset, offset + length);
    offset += length;
    return blob;
  });

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(await inflateRaw(body)));
  } catch {
    throw new Error("Vinegar file is truncated or corrupt.");
  }
  return parseVinegarFile(rehydrateAssets(data, blobs));
}

/**
 * Parse whichever form `bytes` hold: the container, or the same file as JSON
 * text. The one reader for "bytes to document" — files, drops and the
 * clipboard payload all come through here, so none of them has to guess.
 */
export async function parseDocumentBytes(bytes: Uint8Array): Promise<Document> {
  if (isContainer(bytes)) return decodeDocument(bytes);
  return parseDocument(new TextDecoder().decode(bytes));
}

/** Move every asset's data URL into `blobs`, leaving a reference behind. */
function externalizeAssets(
  assets: Document["assets"],
  blobs: Uint8Array[]
): Document["assets"] {
  const out: Record<string, DocumentAsset> = {};
  for (const [id, asset] of Object.entries(assets)) {
    const base64 = /^(data:[^,]*;base64,)(.*)$/s.exec(asset.source.data);
    const source: BlobSource = base64
      ? { type: "blob", index: blobs.length, base64Prefix: base64[1]! }
      : { type: "blob", index: blobs.length, base64Prefix: null };
    blobs.push(
      base64
        ? decodeBase64(base64[2]!)
        : new TextEncoder().encode(asset.source.data)
    );
    // The blob reference is not a legal `DocumentAsset["source"]`; it only ever
    // exists inside an encoded body, and `rehydrateAssets` undoes it.
    out[id] = { ...asset, source: source as unknown as DocumentAsset["source"] };
  }
  return out;
}

/**
 * Put the data URLs back before validation. Anything that does not look like a
 * blob reference is left alone, so a malformed body still fails in the one
 * place that reports document errors.
 */
function rehydrateAssets(data: unknown, blobs: Uint8Array[]): unknown {
  if (!data || typeof data !== "object") return data;
  const file = data as { document?: { assets?: Record<string, unknown> } };
  const assets = file.document?.assets;
  if (!assets || typeof assets !== "object") return data;

  const restored: Record<string, unknown> = {};
  for (const [id, asset] of Object.entries(assets)) {
    const source = (asset as { source?: unknown })?.source as Partial<BlobSource>;
    const blob = source?.type === "blob" ? blobs[source.index ?? -1] : undefined;
    if (!blob) {
      restored[id] = asset;
      continue;
    }
    const data =
      typeof source.base64Prefix === "string"
        ? source.base64Prefix + encodeBase64(blob)
        : new TextDecoder().decode(blob);
    restored[id] = { ...(asset as object), source: { type: "data", data } };
  }
  return { ...file, document: { ...file.document, assets: restored } };
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new CompressionStream("deflate-raw"));
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new DecompressionStream("deflate-raw"));
}

async function through(
  bytes: Uint8Array,
  transform: ReadableWritablePair<Uint8Array, BufferSource>
): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Chunked so a multi-megabyte asset cannot blow the argument limit. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
