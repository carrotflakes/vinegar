import { useEffect, useRef, useState } from "react";
import { downloadBlob, downloadText, pickTextFile } from "../io/download";
import { exportPng } from "../io/exportPng";
import { exportSvg } from "../io/exportSvg";
import { parseDocument, serializeDocument } from "../io/serialize";
import { useEditor } from "../store/editorStore";
import { createDemoDocument } from "../demo/createDemoDocument";

interface MenuItem {
  label: string;
  run: () => void | Promise<void>;
  separatorBefore?: boolean;
}

export default function FileMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside press or Escape (pointerdown, not mousedown — the
  // canvas captures pointers, which suppresses compatibility mouse events).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const items: MenuItem[] = [
    {
      label: "New",
      run: () => {
        const s = useEditor.getState();
        if (
          s.doc.rootIds.length > 0 &&
          !window.confirm("Discard the current drawing and start a new one?")
        ) {
          return;
        }
        s.newDocument();
      },
    },
    {
      label: "Open…",
      run: async () => {
        const text = await pickTextFile(".json,application/json");
        if (text == null) return;
        try {
          useEditor.getState().loadDocument(parseDocument(text));
        } catch (err) {
          window.alert(
            "Could not open file:\n" +
              (err instanceof Error ? err.message : String(err))
          );
        }
      },
    },
    {
      label: "Save (.json)",
      separatorBefore: true,
      run: () => {
        const json = serializeDocument(useEditor.getState().doc);
        downloadText(json, "drawing.vinegar.json", "application/json");
      },
    },
    {
      label: "Export PNG",
      separatorBefore: true,
      run: async () => {
        try {
          const blob = await exportPng(useEditor.getState().doc, { scale: 2 });
          downloadBlob(blob, "drawing.png");
        } catch (err) {
          window.alert(err instanceof Error ? err.message : String(err));
        }
      },
    },
    {
      label: "Export SVG",
      run: () => {
        try {
          const svg = exportSvg(useEditor.getState().doc);
          downloadText(svg, "drawing.svg", "image/svg+xml");
        } catch (err) {
          window.alert(err instanceof Error ? err.message : String(err));
        }
      },
    },
    {
      label: "Demo",
      separatorBefore: true,
      run: () => {
        const editor = useEditor.getState();
        if (
          editor.doc.rootIds.length > 0 &&
          !window.confirm("Discard the current drawing and open the demo?")
        ) {
          return;
        }
        editor.loadDocument(createDemoDocument());
        editor.setViewport({ scale: 0.85, offset: { x: 12, y: 12 } });
      },
    },
  ];

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        className={"ghost-btn" + (open ? " active" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        File ▾
      </button>
      {open && (
        <div className="menu-popover" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={
                "menu-item" + (item.separatorBefore ? " sep" : "")
              }
              onClick={async () => {
                setOpen(false);
                await item.run();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
