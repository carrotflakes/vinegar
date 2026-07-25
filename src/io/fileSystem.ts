// Thin wrapper over the File System Access API, so File ▸ Save can overwrite
// the file the document was opened from instead of dropping a new copy into
// Downloads every time. The API is Chromium-only today; every caller must be
// able to fall back to `io/download.ts`, which is what `supportsFileSystem()`
// gates on.

/**
 * Minimal structural types for the parts of the API we use. TypeScript's DOM
 * lib only ships these behind a newer target in some setups, and declaring them
 * here keeps the wrapper self-contained.
 */
export interface FileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: BlobPart): Promise<void>;
    close(): Promise<void>;
  }>;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  isSameEntry?(other: FileHandle): Promise<boolean>;
}

interface PickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
}

interface FileSystemWindow {
  showOpenFilePicker?(options?: PickerOptions): Promise<FileHandle[]>;
  showSaveFilePicker?(options?: PickerOptions): Promise<FileHandle>;
}

const fsWindow = () => window as unknown as FileSystemWindow;

/** Whether this browser can save straight back to a picked file. */
export function supportsFileSystem(): boolean {
  return typeof fsWindow().showSaveFilePicker === "function";
}

/** Picker filter for our own document format. */
const vinegarFileTypes = () => [
  {
    description: "Vinegar drawing",
    accept: { "application/json": [".vinegar.json", ".json"] },
  },
];

/** True when the user cancelled a picker, as opposed to a real failure. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Ensure we may still write to `handle`. A handle restored across a reload (or
 * left idle) can drop back to "prompt", which needs a user gesture to regain —
 * callers run this inside the click/shortcut that triggered the save.
 */
export async function ensureWritePermission(handle: FileHandle): Promise<boolean> {
  const descriptor = { mode: "readwrite" } as const;
  if ((await handle.queryPermission?.(descriptor)) === "granted") return true;
  return (await handle.requestPermission?.(descriptor)) === "granted";
}

/** Show the open picker; resolves null when the user cancels. */
export async function pickDocumentToOpen(): Promise<FileHandle | null> {
  const show = fsWindow().showOpenFilePicker;
  if (!show) return null;
  try {
    const [handle] = await show({
      types: vinegarFileTypes(),
      multiple: false,
    });
    return handle ?? null;
  } catch (err) {
    if (isAbortError(err)) return null;
    throw err;
  }
}

/** Show the save picker; resolves null when the user cancels. */
export async function pickDocumentToSave(
  suggestedName: string
): Promise<FileHandle | null> {
  const show = fsWindow().showSaveFilePicker;
  if (!show) return null;
  try {
    return await show({
      suggestedName,
      types: vinegarFileTypes(),
    });
  } catch (err) {
    if (isAbortError(err)) return null;
    throw err;
  }
}

/** Overwrite `handle` with `text`. Throws if the write fails. */
export async function writeTextToHandle(
  handle: FileHandle,
  text: string
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(new Blob([text], { type: "application/json" }));
  } finally {
    await writable.close();
  }
}

/**
 * A file handle carried by a drop, where the browser exposes one (Chromium).
 * Lets dropping a document adopt it for later overwrite-saving, exactly like
 * opening it through the picker.
 */
export async function handleFromDataTransferItem(
  item: DataTransferItem
): Promise<FileHandle | null> {
  const get = (item as DataTransferItem & {
    getAsFileSystemHandle?: () => Promise<{ kind: string } | null>;
  }).getAsFileSystemHandle;
  if (typeof get !== "function") return null;
  try {
    const handle = await get.call(item);
    return handle && handle.kind === "file" ? (handle as unknown as FileHandle) : null;
  } catch {
    return null;
  }
}
