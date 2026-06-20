import { useEditor, type ToolId } from "../store/editorStore";

interface ToolDef {
  id: ToolId;
  label: string;
  hint: string;
  icon: string;
}

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", hint: "V", icon: "⬚" },
  { id: "rect", label: "Rectangle", hint: "R", icon: "▭" },
  { id: "ellipse", label: "Ellipse", hint: "O", icon: "◯" },
  { id: "line", label: "Line", hint: "L", icon: "╱" },
  { id: "pen", label: "Pencil", hint: "P", icon: "✎" },
];

export default function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={"tool-btn" + (tool === t.id ? " active" : "")}
          onClick={() => setTool(t.id)}
          title={`${t.label} (${t.hint})`}
        >
          <span className="tool-icon" aria-hidden>
            {t.icon}
          </span>
          <span className="tool-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
