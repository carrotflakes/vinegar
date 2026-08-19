import { loadDemoDocument } from "@/demo/demoDocument";
import {
  downloadBlob,
  downloadText,
  pickFile,
  pickTextFileWithName,
} from "@/io/download";
import { contentBounds } from "@/io/exportBounds";
import { fileSlug, uniqueFileSlugs } from "@/io/exportFilenames";
import { exportPng } from "@/io/exportPng";
import { exportSvg } from "@/io/exportSvg";
import {
  pickDocumentToOpen,
  supportsFileSystem,
  type FileHandle,
} from "@/io/fileSystem";
import { pickImageFiles } from "@/io/importImage";
import { importSvg } from "@/io/importSvg";
import { loadDocumentFile } from "@/io/openDocument";
import { saveDocument, saveDocumentAs } from "@/io/saveDocument";
import { nodeWorldBounds } from "@/model/geometry/bounds";
import {
  fitBoundsInViewport,
  initialViewport,
} from "@/model/geometry/viewport";
import { framesInPaintOrder, isFrame } from "@/model/scene";
import type { FrameNode } from "@/model/types";
import { useDocumentFile } from "@/store/documentFileStore";
import { hasUnsavedChanges } from "@/store/editorStore";
import type { EditorState } from "@/store/state";
import { notify } from "@/store/toastStore";
import { useUi } from "@/store/uiStore";
import {
  canvasViewportSize,
  placeImagesFitted,
  placeSvgFitted,
} from "./canvasPlacement";
import type { Command } from "./types";

/**
 * Guard for actions that replace the current document (new / open / demo).
 * Prompts only when there are unsaved changes; returns whether to proceed.
 */
function confirmDiscard(state: EditorState): boolean {
  if (!hasUnsavedChanges(state)) return true;
  return window.confirm("Discard unsaved changes to the current drawing?");
}

/** The lone selected frame node, or null. */
function selectedFrame(state: EditorState): FrameNode | null {
  if (state.selection.length !== 1) return null;
  const node = state.doc.nodes[state.selection[0]];
  return isFrame(node) ? node : null;
}

/** Frames "Export all" writes: hidden ones render nothing, so they are skipped. */
function exportableFrames(state: EditorState): FrameNode[] {
  return framesInPaintOrder(state.doc).filter((frame) => !frame.hidden);
}

export const FILE_COMMANDS: Command[] = [
  {
    id: "file.new",
    label: "New",
    group: "File",
    run: (state) => {
      if (!confirmDiscard(state)) return;
      state.newDocument();
      useDocumentFile.getState().clear();
    },
  },
  {
    id: "file.open",
    label: "Open…",
    group: "File",
    run: async (state) => {
      if (!confirmDiscard(state)) return;
      // Prefer the File System Access picker so the opened file can be
      // overwritten by a later Save; fall back to a plain <input type=file>.
      if (supportsFileSystem()) {
        let handle: FileHandle | null;
        let file: File;
        try {
          handle = await pickDocumentToOpen();
          if (!handle) return;
          file = await handle.getFile();
        } catch (error) {
          notify.error(
            "Could not open file:\n" +
              (error instanceof Error ? error.message : String(error))
          );
          return;
        }
        await loadDocumentFile(file, handle);
        return;
      }
      const file = await pickFile(".vinegar,.json,application/json");
      if (!file) return;
      await loadDocumentFile(file);
    },
  },
  {
    id: "file.importSvg",
    label: "Import SVG…",
    group: "File",
    run: async (_state, context) => {
      const file = await pickTextFileWithName(".svg,image/svg+xml");
      if (!file) return;
      try {
        const name = file.name.replace(/\.[^.]+$/, "") || "Imported SVG";
        placeSvgFitted(importSvg(file.text, name), context?.at);
      } catch (error) {
        notify.error(
          "Could not import SVG:\n" +
            (error instanceof Error ? error.message : String(error))
        );
      }
    },
  },
  {
    id: "file.placeImage",
    label: "Place image…",
    group: "File",
    run: async (_state, context) => {
      const files = await pickImageFiles();
      if (!files.length) return;
      await placeImagesFitted(files, context?.at);
    },
  },
  {
    id: "file.save",
    label: "Save",
    group: "File",
    keys: [{ key: "s", mod: true }],
    run: () => void saveDocument(),
  },
  {
    id: "file.saveAs",
    label: "Save As…",
    group: "File",
    keys: [{ key: "s", mod: true, shift: true }],
    run: () => void saveDocumentAs(),
  },
  {
    id: "file.exportImage",
    label: "Export image…",
    group: "File",
    run: () => useUi.getState().openExport(),
  },
  {
    id: "file.exportPng",
    label: "Export PNG",
    group: "File",
    run: async (state) => {
      try {
        const blob = await exportPng(state.doc, { scale: 2 });
        downloadBlob(blob, `${fileSlug(state.doc.metadata.name)}.png`);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: "file.exportSvg",
    label: "Export SVG",
    group: "File",
    run: (state) => {
      try {
        const svg = exportSvg(state.doc);
        downloadText(
          svg,
          `${fileSlug(state.doc.metadata.name)}.svg`,
          "image/svg+xml"
        );
      } catch (error) {
        notify.error(error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: "file.exportFramePng",
    label: "Export frame PNG",
    group: "File",
    // A hidden frame renders nothing, so exporting it would write an empty image.
    enabled: (state) => {
      const frame = selectedFrame(state);
      return !!frame && !frame.hidden;
    },
    run: async (state) => {
      const frame = selectedFrame(state);
      const bounds = frame && nodeWorldBounds(state.doc, frame.id);
      if (!frame || !bounds) return;
      try {
        const blob = await exportPng(state.doc, {
          scale: 2,
          bounds,
          background: frame.background ?? undefined,
        });
        downloadBlob(blob, `${fileSlug(frame.name)}.png`);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: "file.exportFrameSvg",
    label: "Export frame SVG",
    group: "File",
    // A hidden frame renders nothing, so exporting it would write an empty image.
    enabled: (state) => {
      const frame = selectedFrame(state);
      return !!frame && !frame.hidden;
    },
    run: (state) => {
      const frame = selectedFrame(state);
      const bounds = frame && nodeWorldBounds(state.doc, frame.id);
      if (!frame || !bounds) return;
      try {
        const svg = exportSvg(state.doc, {
          bounds,
          background: frame.background,
        });
        downloadText(svg, `${fileSlug(frame.name)}.svg`, "image/svg+xml");
      } catch (error) {
        notify.error(error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: "file.exportAllFramesPng",
    label: "Export all frames (PNG)",
    group: "File",
    enabled: (state) => exportableFrames(state).length > 0,
    run: async (state) => {
      try {
        const frames = exportableFrames(state);
        const slugs = uniqueFileSlugs(frames.map((frame) => frame.name));
        for (const [index, frame] of frames.entries()) {
          const bounds = nodeWorldBounds(state.doc, frame.id);
          if (!bounds) continue;
          const blob = await exportPng(state.doc, {
            scale: 2,
            bounds,
            background: frame.background ?? undefined,
          });
          downloadBlob(blob, `${slugs[index]}.png`);
        }
      } catch (error) {
        notify.error(error instanceof Error ? error.message : String(error));
      }
    },
  },
  {
    id: "file.demo",
    label: "Open demo",
    group: "File",
    run: async (state) => {
      if (!confirmDiscard(state)) return;
      const doc = await loadDemoDocument();
      state.loadDocument(doc);
      useDocumentFile.getState().clear();
      // The demo is a multi-frame tour, so open it fitted rather than at a
      // fixed zoom that would land on one corner of it.
      const bounds = contentBounds(doc, 0, null);
      state.setViewport(
        bounds
          ? fitBoundsInViewport(bounds, canvasViewportSize())
          : initialViewport
      );
    },
  },
  {
    id: "app.preferences",
    label: "Preferences…",
    group: "App",
    run: () => useUi.getState().openPreferences(),
  },
];
