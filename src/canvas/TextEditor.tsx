import { useEffect, useRef } from "react";
import { multiply, shapeWorldMatrix, translation } from "@/model/geometry/matrix";
import { resolvePaint, scopeForNode } from "../model/vars";
import type { TextShape } from "../model/types";
import { viewportMatrix } from "@/model/geometry/viewport";
import { useEditor } from "../store/editorStore";
import { fontStack } from "../fonts";
import "./TextEditor.css";

interface Props {
  shape: TextShape;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export default function TextEditor({ shape, onChange, onCommit, onCancel }: Props) {
  const doc = useEditor((state) => state.doc);
  const viewport = useEditor((state) => state.viewport);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);

  useEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const localToScreen = multiply(
    viewportMatrix(viewport),
    multiply(shapeWorldMatrix(doc, shape), translation(shape.x, shape.y))
  );

  // Resolve a `var` fill reference so the overlay matches the painted colour.
  // Text is edited where it lives, so the chain is the document's variables
  // plus — in symbol-edit focus — the definition's own parameter defaults.
  const fill = resolvePaint(shape.fill, scopeForNode(doc, shape.id));

  return (
    <textarea
      ref={textarea}
      className="text-editor-overlay"
      value={shape.text}
      wrap={shape.textMode === "area" ? "soft" : "off"}
      spellCheck={false}
      aria-label="Edit text"
      style={{
        width: `${shape.width}px`,
        height: `${shape.height}px`,
        transform: `matrix(${localToScreen.join(",")})`,
        fontFamily: fontStack(shape.fontFamily),
        fontSize: `${shape.fontSize}px`,
        fontWeight: shape.fontWeight,
        fontStyle: shape.italic ? "italic" : "normal",
        lineHeight: String(shape.lineHeight),
        textAlign: shape.align,
        whiteSpace: shape.textMode === "point" ? "pre" : "pre-wrap",
        color: fill?.type === "solid" ? fill.color : "#111827",
      }}
      onChange={(event) => onChange(event.target.value)}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (
          event.key === "Enter" &&
          (event.ctrlKey || event.metaKey) &&
          !composing.current
        ) {
          event.preventDefault();
          onCommit();
        }
      }}
      onBlur={onCommit}
    />
  );
}
