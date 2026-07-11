import type { ComponentType } from "react";
import {
  LuMousePointer2,
  LuSpline,
  LuSquare,
  LuCircle,
  LuSlash,
  LuPenTool,
  LuPencil,
} from "react-icons/lu";
import { useEditor, type ToolId } from "../store/editorStore";

interface ToolDef {
  id: ToolId;
  label: string;
  hint: string;
  icon: ComponentType;
}

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", hint: "V", icon: LuMousePointer2 },
  { id: "node", label: "Edit Nodes", hint: "N", icon: LuSpline },
  { id: "rect", label: "Rectangle", hint: "R", icon: LuSquare },
  { id: "ellipse", label: "Ellipse", hint: "O", icon: LuCircle },
  { id: "line", label: "Line", hint: "L", icon: LuSlash },
  { id: "pen", label: "Pen", hint: "P", icon: LuPenTool },
  { id: "pencil", label: "Pencil", hint: "B", icon: LuPencil },
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
            <t.icon />
          </span>
          <span className="tool-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
