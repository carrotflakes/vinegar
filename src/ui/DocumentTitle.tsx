import { useEffect, useRef, useState } from "react";
import { hasUnsavedChanges, useEditor } from "../store/editorStore";
import { useDocumentFile } from "../store/documentFileStore";

/**
 * The document name in the middle of the app bar: click to rename, Enter or
 * blur to commit, Escape to revert. Renaming is not an undoable edit (see
 * `setDocumentName`), so it deliberately does not go through the history.
 *
 * A trailing dot marks unsaved changes, and the tooltip names the file on disk
 * the document is attached to — the thing File ▸ Save will overwrite.
 */
export default function DocumentTitle() {
  const name = useEditor((s) => s.doc.metadata.name);
  const setDocumentName = useEditor((s) => s.setDocumentName);
  const dirty = useEditor(hasUnsavedChanges);
  const fileName = useDocumentFile((s) => s.fileName);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setDocumentName(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="doc-title-input"
        value={draft}
        aria-label="Document name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Keep Enter/Escape from reaching whatever else listens for them.
          e.stopPropagation();
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <button
      className="doc-title"
      aria-label={`Document name: ${name}${dirty ? ", unsaved changes" : ""}`}
      title={
        (fileName ?? "Not saved to a file yet") +
        (dirty ? " · unsaved changes" : "") +
        " — click to rename"
      }
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
    >
      <span className="doc-title-name">{name}</span>
      {dirty && <span className="doc-title-dirty" aria-hidden />}
    </button>
  );
}
