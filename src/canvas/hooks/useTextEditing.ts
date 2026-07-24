import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TextShape } from "../../model/types";
import { useEditor } from "../../store/editorStore";
import { measureTextShape } from "../textLayout";

export interface TextEditSession {
  shape: TextShape;
  original: TextShape | null;
  previousSelection: string[];
}

export interface TextEditing {
  /** Session backing the DOM `<TextEditor>`, or null when not editing. */
  textEdit: TextEditSession | null;
  /** Same session as a ref, for reads outside the React render (draw/pointer). */
  textEditRef: RefObject<TextEditSession | null>;
  beginTextEdit: (shape: TextShape, original: TextShape | null) => void;
  commitTextEdit: (expectedId?: string) => void;
  cancelTextEdit: (expectedId?: string) => void;
  changeTextEdit: (text: string) => void;
}

/** Owns the inline text-edit session lifecycle and its font-metrics refresh. */
export function useTextEditing(scheduleDraw: () => void): TextEditing {
  const textEditRef = useRef<TextEditSession | null>(null);
  const [textEdit, setTextEditState] = useState<TextEditSession | null>(null);

  const setTextEdit = useCallback(
    (session: TextEditSession | null) => {
      textEditRef.current = session;
      setTextEditState(session);
      scheduleDraw();
    },
    [scheduleDraw]
  );

  const beginTextEdit = useCallback(
    (shape: TextShape, original: TextShape | null) => {
      const state = useEditor.getState();
      const previousSelection = state.selection;
      state.setSelection([shape.id]);
      setTextEdit({ shape, original, previousSelection });
    },
    [setTextEdit]
  );

  const commitTextEdit = useCallback(
    (expectedId?: string) => {
      const session = textEditRef.current;
      if (!session || (expectedId && session.shape.id !== expectedId)) return;
      textEditRef.current = null;
      setTextEditState(null);
      const state = useEditor.getState();
      const isEmpty = session.shape.text.trim() === "";
      if (session.original) {
        if (isEmpty) {
          // Emptying an existing text removes it rather than leaving an
          // invisible, unselectable node behind.
          state.setSelection([session.shape.id]);
          state.deleteSelected();
        } else if (JSON.stringify(session.shape) !== JSON.stringify(session.original)) {
          // Skip the no-op history entry when nothing actually changed.
          state.updateShape(session.shape);
        }
      } else if (!isEmpty) {
        state.addShape(session.shape);
      } else {
        // A freshly created text left empty never becomes a document node.
        state.setSelection(session.previousSelection);
      }
      scheduleDraw();
    },
    [scheduleDraw]
  );

  const cancelTextEdit = useCallback(
    (expectedId?: string) => {
      const session = textEditRef.current;
      if (!session || (expectedId && session.shape.id !== expectedId)) return;
      setTextEdit(null);
      if (session && !session.original) {
        useEditor.getState().setSelection(session.previousSelection);
      }
    },
    [setTextEdit]
  );

  const changeTextEdit = useCallback(
    (text: string) => {
      const session = textEditRef.current;
      if (!session) return;
      setTextEdit({ ...session, shape: measureTextShape({ ...session.shape, text }) });
    },
    [setTextEdit]
  );

  // Font metrics can change after the document first paints. Refresh the
  // persisted text bounds without creating an undo entry.
  useEffect(() => {
    if (!("fonts" in document)) return;
    let active = true;
    const refresh = () => {
      if (!active) return;
      useEditor.getState().remeasureTextShapes();
      const session = textEditRef.current;
      if (session) setTextEdit({ ...session, shape: measureTextShape(session.shape) });
      scheduleDraw();
    };
    void document.fonts.ready.then(refresh);
    document.fonts.addEventListener("loadingdone", refresh);
    return () => {
      active = false;
      document.fonts.removeEventListener("loadingdone", refresh);
    };
  }, [scheduleDraw, setTextEdit]);

  return {
    textEdit,
    textEditRef,
    beginTextEdit,
    commitTextEdit,
    cancelTextEdit,
    changeTextEdit,
  };
}
