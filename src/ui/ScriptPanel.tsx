import { useState } from "react";
import { LuX } from "react-icons/lu";
import { runScript } from "../script/runScript";
import { useEditor } from "../store/editorStore";
import { shapesInPaintOrder } from "../model/scene";

const STORAGE_KEY = "vinegar.script";

const DEFAULT_SCRIPT = `// Drawing script — runs in a sandbox, then applies its changes in one undo.
// Create:  rect(x,y,w,h) ellipse(cx,cy,rx,ry) circle(cx,cy,r)
//          line(x1,y1,x2,y2) path(points,closed) polygon(points)
//          push() pop() translate(x,y) rotate(rad) scale(s)
//          fill(c) stroke(c) strokeWidth(w) opacity(o) blendMode('multiply')
// Existing: shapes, selection, byType('rect'), bounds(s) -> {x,y,width,height,cx,cy}
//          edit a shape by mutating it; move(s,dx,dy); remove(s)
// Utils:   repeat(n, i => ...) seed(n) random(a,b) lerp(a,b,t)  DEG TAU PI

seed(1);
stroke(null);
translate(300, 300);
repeat(36, (i) => {
  push();
  rotate(i * 10 * DEG);
  fill(i % 2 ? '#4f8cff' : '#1b2440');
  rect(120, -6, 80, 12);
  pop();
});
fill('#ffce4f');
circle(0, 0, 28);

// Edit existing: recolor selected rects
// for (const s of selection) if (s.type === 'rect') s.fill = '#e53935';
`;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ScriptPanel({ open, onClose }: Props) {
  const applyScriptChanges = useEditor((s) => s.applyScriptChanges);
  const [code, setCode] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? DEFAULT_SCRIPT
  );
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    null
  );
  const [running, setRunning] = useState(false);

  if (!open) return null;

  const run = async () => {
    localStorage.setItem(STORAGE_KEY, code);
    setRunning(true);
    setStatus(null);
    const { doc, selection } = useEditor.getState();
    const snapshot = {
      shapes: shapesInPaintOrder(doc),
      selectionIds: selection,
    };
    const result = await runScript(code, snapshot);
    setRunning(false);
    if (result.error) {
      setStatus({ kind: "err", msg: result.error });
      return;
    }
    const created = result.created ?? [];
    const updated = result.updated ?? [];
    const deleted = result.deleted ?? [];
    if (created.length + updated.length + deleted.length === 0) {
      setStatus({ kind: "err", msg: "Script made no changes." });
      return;
    }
    applyScriptChanges({ created, updated, deleted });
    setStatus({
      kind: "ok",
      msg: `Created ${created.length}, updated ${updated.length}, deleted ${deleted.length}.`,
    });
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal script-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Script</span>
          <button className="modal-close" onClick={onClose} title="Close" aria-label="Close">
            <LuX aria-hidden />
          </button>
        </div>
        <textarea
          className="script-editor"
          value={code}
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              run();
            }
          }}
        />
        <div className="modal-foot">
          <span
            className={
              "script-status" + (status ? ` ${status.kind}` : "")
            }
          >
            {status?.msg ?? "Ctrl/⌘ + Enter to run"}
          </span>
          <button className="run-btn" onClick={run} disabled={running}>
            {running ? "Running…" : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
