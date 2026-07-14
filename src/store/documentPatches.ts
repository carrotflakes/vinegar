import type { Document } from "../model/types";

export type DocumentMapField = "nodes" | "symbols" | "assets" | "extensions";
export type DocumentArrayField = "rootIds" | "artboards";
export type DocumentValueField = "settings" | "metadata";

type MapValue<F extends DocumentMapField> = Document[F] extends Record<string, infer V> ? V : never;
type ArrayValue<F extends DocumentArrayField> = Document[F] extends Array<infer V> ? V : never;
type DocumentMapPatch = { [F in DocumentMapField]: { type: "map"; field: F; set: Array<[string, MapValue<F>]>; remove: string[] } }[DocumentMapField];
type DocumentArrayPatch = { [F in DocumentArrayField]: { type: "splice"; field: F; index: number; deleteCount: number; items: ArrayValue<F>[] } }[DocumentArrayField];
type DocumentValuePatch = { [F in DocumentValueField]: { type: "replace"; field: F; value: Document[F] } }[DocumentValueField];

export type DocumentPatch = DocumentMapPatch | DocumentArrayPatch | DocumentValuePatch;

export interface DocumentPatchPair {
  patches: DocumentPatch[];
  inversePatches: DocumentPatch[];
}

const MAP_FIELDS = ["nodes", "symbols", "assets", "extensions"] as const;
const ARRAY_FIELDS = ["rootIds", "artboards"] as const;
const VALUE_FIELDS = ["settings", "metadata"] as const;
type PatchedDocumentField = (typeof MAP_FIELDS)[number] | (typeof ARRAY_FIELDS)[number] | (typeof VALUE_FIELDS)[number];
const allDocumentFieldsPatched: [Exclude<keyof Document, PatchedDocumentField>] extends [never] ? true : never = true;
void allDocumentFieldsPatched;

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function valuesEqual(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (typeof before !== "object" || before === null || typeof after !== "object" || after === null) return false;
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return false;
    return before.every((value, index) => valuesEqual(value, after[index]));
  }
  const beforeRecord = before as Record<string, unknown>, afterRecord = after as Record<string, unknown>;
  const keys = Object.keys(beforeRecord);
  if (keys.length !== Object.keys(afterRecord).length) return false;
  return keys.every((key) => hasOwn(afterRecord, key) && valuesEqual(beforeRecord[key], afterRecord[key]));
}

export function documentsEqual(before: Document, after: Document): boolean {
  return valuesEqual(before, after);
}

function diffMap<F extends DocumentMapField>(field: F, before: Document[F], after: Document[F], patches: DocumentPatch[], inversePatches: DocumentPatch[]) {
  if (before === after) return;
  const beforeRecord = before as Record<string, MapValue<F>>, afterRecord = after as Record<string, MapValue<F>>;
  const set: Array<[string, MapValue<F>]> = [], remove: string[] = [];
  const inverseSet: Array<[string, MapValue<F>]> = [], inverseRemove: string[] = [];
  for (const key of Object.keys(beforeRecord)) {
    if (!hasOwn(afterRecord, key)) { remove.push(key); inverseSet.push([key, beforeRecord[key]]); }
  }
  for (const key of Object.keys(afterRecord)) {
    if (!hasOwn(beforeRecord, key)) { set.push([key, afterRecord[key]]); inverseRemove.push(key); }
    else if (beforeRecord[key] !== afterRecord[key]) { set.push([key, afterRecord[key]]); inverseSet.push([key, beforeRecord[key]]); }
  }
  if (!set.length && !remove.length) return;
  patches.push({ type: "map", field, set, remove } as DocumentPatch);
  inversePatches.push({ type: "map", field, set: inverseSet, remove: inverseRemove } as DocumentPatch);
}

function diffArray<F extends DocumentArrayField>(field: F, before: Document[F], after: Document[F], patches: DocumentPatch[], inversePatches: DocumentPatch[]) {
  if (before === after) return;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length, afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) { beforeEnd -= 1; afterEnd -= 1; }
  if (start === beforeEnd && start === afterEnd) return;
  patches.push({ type: "splice", field, index: start, deleteCount: beforeEnd - start, items: after.slice(start, afterEnd) } as DocumentPatch);
  inversePatches.push({ type: "splice", field, index: start, deleteCount: afterEnd - start, items: before.slice(start, beforeEnd) } as DocumentPatch);
}

export function diffDocument(before: Document, after: Document): DocumentPatchPair {
  const patches: DocumentPatch[] = [], inversePatches: DocumentPatch[] = [];
  for (const field of MAP_FIELDS) diffMap(field, before[field], after[field], patches, inversePatches);
  for (const field of ARRAY_FIELDS) diffArray(field, before[field], after[field], patches, inversePatches);
  for (const field of VALUE_FIELDS) {
    if (before[field] === after[field]) continue;
    patches.push({ type: "replace", field, value: after[field] } as DocumentPatch);
    inversePatches.push({ type: "replace", field, value: before[field] } as DocumentPatch);
  }
  return { patches, inversePatches };
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

function replaceRange<T>(array: readonly T[], index: number, deleteCount: number, items: readonly T[]): T[] {
  const result = array.slice(0, index);
  for (const item of items) result.push(item);
  for (let i = index + deleteCount; i < array.length; i += 1) result.push(array[i]);
  return result;
}

export function applyDocumentPatches(doc: Document, patches: readonly DocumentPatch[]): Document {
  if (!patches.length) return doc;
  let nodes: Document["nodes"] | null = null, symbols: Document["symbols"] | null = null, assets: Document["assets"] | null = null, extensions: Document["extensions"] | null = null;
  let rootIds: Document["rootIds"] | null = null, artboards: Document["artboards"] | null = null;
  let settings: Document["settings"] | null = null, metadata: Document["metadata"] | null = null;
  for (const patch of patches) {
    if (patch.type === "map") {
      let target: Record<string, unknown>;
      if (patch.field === "nodes") { nodes ??= { ...doc.nodes }; target = nodes; }
      else if (patch.field === "symbols") { symbols ??= { ...doc.symbols }; target = symbols; }
      else if (patch.field === "assets") { assets ??= { ...doc.assets }; target = assets; }
      else { extensions ??= { ...doc.extensions }; target = extensions; }
      for (const key of patch.remove) delete target[key];
      for (const [key, value] of patch.set) setOwn(target, key, value);
    } else if (patch.type === "splice") {
      if (patch.field === "rootIds") rootIds = replaceRange(rootIds ?? doc.rootIds, patch.index, patch.deleteCount, patch.items);
      else artboards = replaceRange(artboards ?? doc.artboards, patch.index, patch.deleteCount, patch.items);
    } else if (patch.field === "settings") settings = patch.value as Document["settings"];
    else metadata = patch.value as Document["metadata"];
  }
  return {
    ...doc,
    ...(nodes ? { nodes } : {}),
    ...(symbols ? { symbols } : {}),
    ...(assets ? { assets } : {}),
    ...(extensions ? { extensions } : {}),
    ...(rootIds ? { rootIds } : {}),
    ...(artboards ? { artboards } : {}),
    ...(settings ? { settings } : {}),
    ...(metadata ? { metadata } : {}),
  };
}
