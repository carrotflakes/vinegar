import type { Document } from "../model/types";
import { useEditor } from "../store/editorStore";
import {
  setRecoveryStatus,
  type RecoveryStatus,
} from "../store/recoveryStore";
import {
  CURRENT_FILE_VERSION,
  parseDocument,
  serializeDocument,
} from "./serialize";

const DB_NAME = "vinegar-recovery";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";
const SNAPSHOT_ID = "current";
export const RECOVERY_FORMAT_VERSION = 1 as const;

export interface RecoverySnapshot {
  id: typeof SNAPSHOT_ID;
  formatVersion: typeof RECOVERY_FORMAT_VERSION;
  fileVersion: number;
  savedAt: string;
  file: string;
}

export interface RecoveryStorage {
  read: () => Promise<RecoverySnapshot | null>;
  write: (doc: Document) => Promise<RecoverySnapshot>;
  clear: () => Promise<void>;
}

class InvalidRecoverySnapshotError extends Error {
  constructor() {
    super("The recovery snapshot is missing or malformed.");
    this.name = "InvalidRecoverySnapshotError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getFactory(factory?: IDBFactory): IDBFactory {
  const available = factory ?? globalThis.indexedDB;
  if (!available) throw new Error("IndexedDB is not available in this browser.");
  return available;
}

function openDatabase(factory?: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = getFactory(factory).open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open recovery storage."));
    request.onblocked = () => reject(new Error("Recovery storage is blocked by another tab."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Recovery storage request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("Recovery storage transaction failed.")
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("Recovery storage transaction was aborted.")
    );
  });
}

function isRecoverySnapshot(value: unknown): value is RecoverySnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<RecoverySnapshot>;
  return snapshot.id === SNAPSHOT_ID &&
    snapshot.formatVersion === RECOVERY_FORMAT_VERSION &&
    typeof snapshot.fileVersion === "number" &&
    typeof snapshot.savedAt === "string" &&
    Number.isFinite(Date.parse(snapshot.savedAt)) &&
    typeof snapshot.file === "string";
}

/** IndexedDB-backed single-slot recovery storage. */
export function createIndexedDbRecoveryStorage(factory?: IDBFactory): RecoveryStorage {
  return {
    async read() {
      const db = await openDatabase(factory);
      try {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(SNAPSHOT_ID);
        const [value] = await Promise.all([
          requestResult<unknown>(request),
          transactionDone(transaction),
        ]);
        if (value === undefined) return null;
        if (!isRecoverySnapshot(value)) throw new InvalidRecoverySnapshotError();
        return value;
      } finally {
        db.close();
      }
    },

    async write(doc) {
      const snapshot: RecoverySnapshot = {
        id: SNAPSHOT_ID,
        formatVersion: RECOVERY_FORMAT_VERSION,
        fileVersion: CURRENT_FILE_VERSION,
        savedAt: new Date().toISOString(),
        file: serializeDocument(doc),
      };
      const db = await openDatabase(factory);
      try {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const request = transaction.objectStore(STORE_NAME).put(snapshot);
        await Promise.all([requestResult(request), transactionDone(transaction)]);
        return snapshot;
      } finally {
        db.close();
      }
    },

    async clear() {
      const db = await openDatabase(factory);
      try {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const request = transaction.objectStore(STORE_NAME).delete(SNAPSHOT_ID);
        await Promise.all([requestResult(request), transactionDone(transaction)]);
      } finally {
        db.close();
      }
    },
  };
}

type StatusSink = (status: RecoveryStatus) => void;

export interface RecoveryRestoreResult {
  restored: boolean;
  error?: string;
}

export interface RecoveryClearResult {
  cleared: boolean;
  error?: string;
}

/** Clear browser recovery data when recovery autosave is disabled. */
export async function clearDocumentRecovery(options: {
  storage?: RecoveryStorage;
  onStatus?: StatusSink;
} = {}): Promise<RecoveryClearResult> {
  const storage = options.storage ?? createIndexedDbRecoveryStorage();
  const onStatus = options.onStatus ?? setRecoveryStatus;
  try {
    await storage.clear();
    onStatus({ phase: "ready" });
    return { cleared: true };
  } catch (error) {
    const message = `Recovery snapshot could not be cleared: ${errorMessage(error)}`;
    onStatus({ phase: "error", error: message });
    return { cleared: false, error: message };
  }
}

/** Ask the user whether to restore a snapshot; OK restores, Cancel discards. */
function defaultRestorePrompt(snapshot: RecoverySnapshot): boolean {
  if (typeof window === "undefined") return true;
  const when = new Date(snapshot.savedAt);
  const label = Number.isFinite(when.getTime())
    ? when.toLocaleString()
    : "a previous session";
  return window.confirm(
    `Restore unsaved work from ${label}?\n\n` +
      "OK restores it. Cancel discards it permanently."
  );
}

/** Read and validate the last dirty snapshot, then restore it if confirmed. */
export async function restoreRecoveryAtStartup(options: {
  storage?: RecoveryStorage;
  onStatus?: StatusSink;
  /** Decide whether to restore a found snapshot (defaults to a confirm dialog). */
  confirm?: (snapshot: RecoverySnapshot) => boolean;
} = {}): Promise<RecoveryRestoreResult> {
  const storage = options.storage ?? createIndexedDbRecoveryStorage();
  const onStatus = options.onStatus ?? setRecoveryStatus;
  const confirmRestore = options.confirm ?? defaultRestorePrompt;
  let snapshot: RecoverySnapshot | null;

  try {
    snapshot = await storage.read();
  } catch (error) {
    if (error instanceof InvalidRecoverySnapshotError) {
      try { await storage.clear(); } catch { /* The original error is more useful. */ }
    }
    const message = errorMessage(error);
    onStatus({ phase: "error", error: message });
    return { restored: false, error: message };
  }

  if (!snapshot) {
    onStatus({ phase: "ready" });
    return { restored: false };
  }

  if (!confirmRestore(snapshot)) {
    // User chose to discard; drop the snapshot so it never resurfaces.
    try { await storage.clear(); } catch { /* A later autosave can overwrite it. */ }
    onStatus({ phase: "ready" });
    return { restored: false };
  }

  try {
    const doc = parseDocument(snapshot.file);
    useEditor.getState().recoverDocument(doc);
    onStatus({ phase: "recovered", at: snapshot.savedAt });
    return { restored: true };
  } catch (error) {
    try { await storage.clear(); } catch { /* A later autosave can overwrite it. */ }
    const message = `Recovery could not be restored: ${errorMessage(error)}`;
    onStatus({ phase: "error", error: message });
    return { restored: false, error: message };
  }
}

interface AutosaveState {
  doc: Document;
  savedDoc: Document;
}

interface AutosaveSource {
  getState: () => AutosaveState;
  subscribe: (
    listener: (state: AutosaveState, previous: AutosaveState) => void
  ) => () => void;
}

export interface AutosaveController {
  flush: () => void;
  stop: () => void;
}

export interface AutosaveOptions {
  storage?: RecoveryStorage;
  source?: AutosaveSource;
  onStatus?: StatusSink;
  debounceMs?: number;
  maxWaitMs?: number;
  now?: () => number;
}

/**
 * Persist dirty documents on a trailing debounce, capped by maxWaitMs. All
 * storage mutations share one queue so an older write cannot finish after a
 * newer write or clear operation.
 */
export function startDocumentAutosave(options: AutosaveOptions = {}): AutosaveController {
  const storage = options.storage ?? createIndexedDbRecoveryStorage();
  const source = options.source ?? useEditor;
  const onStatus = options.onStatus ?? setRecoveryStatus;
  const debounceMs = options.debounceMs ?? 1000;
  const maxWaitMs = options.maxWaitMs ?? 5000;
  const now = options.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstChangeAt: number | null = null;
  let generation = 0;
  let stopped = false;
  let operations: Promise<void> = Promise.resolve();

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const reportFailure = (error: unknown, operationGeneration: number) => {
    if (stopped || operationGeneration !== generation) return;
    onStatus({ phase: "error", error: errorMessage(error) });
  };

  const enqueue = (
    operation: () => Promise<void>,
    operationGeneration: number
  ) => {
    operations = operations
      .then(operation)
      .catch((error) => reportFailure(error, operationGeneration));
  };

  const enqueueSave = () => {
    const state = source.getState();
    if (state.doc === state.savedDoc) return;
    const doc = state.doc;
    const operationGeneration = generation;
    enqueue(async () => {
      // A newer state already has (or will have) its own queued operation.
      if (operationGeneration !== generation) return;
      const snapshot = await storage.write(doc);
      const current = source.getState();
      if (!stopped && operationGeneration === generation &&
          current.doc === doc && current.doc !== current.savedDoc) {
        onStatus({ phase: "saved", at: snapshot.savedAt });
      }
    }, operationGeneration);
  };

  const flush = () => {
    if (stopped) return;
    clearTimer();
    firstChangeAt = null;
    enqueueSave();
  };

  const schedule = (showSaving: boolean) => {
    clearTimer();
    const currentTime = now();
    firstChangeAt ??= currentTime;
    const untilMaxWait = Math.max(0, maxWaitMs - (currentTime - firstChangeAt));
    const delay = Math.min(debounceMs, untilMaxWait);
    if (showSaving) onStatus({ phase: "saving" });
    timer = setTimeout(flush, delay);
  };

  const handleState = (state: AutosaveState, previous: AutosaveState) => {
    if (state.doc === previous.doc && state.savedDoc === previous.savedDoc) return;
    generation += 1;
    if (state.doc === state.savedDoc) {
      clearTimer();
      firstChangeAt = null;
      const operationGeneration = generation;
      enqueue(async () => {
        await storage.clear();
        if (!stopped && operationGeneration === generation) {
          onStatus({ phase: "ready" });
        }
      }, operationGeneration);
      return;
    }
    schedule(true);
  };

  const unsubscribe = source.subscribe(handleState);
  const initial = source.getState();
  if (initial.doc !== initial.savedDoc) {
    // Preserve the startup "Recovered" message until the first write lands.
    schedule(false);
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flush();
  };
  const onPageHide = () => flush();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
  }

  return {
    flush,
    stop() {
      if (stopped) return;
      stopped = true;
      generation += 1;
      clearTimer();
      unsubscribe();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", onPageHide);
      }
    },
  };
}
