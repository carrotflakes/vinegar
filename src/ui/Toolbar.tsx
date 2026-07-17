import { Fragment, type ComponentType } from "react";
import {
  LuMousePointer2,
  LuSpline,
  LuSquare,
  LuCircle,
  LuSlash,
  LuPenTool,
  LuPencil,
  LuBrush,
  LuFrame,
  LuType,
} from "react-icons/lu";
import { useEditor, type ToolId } from "../store/editorStore";
import "./Toolbar.css";

interface ToolDef {
  id: ToolId;
  label: string;
  hint: string;
  icon: ComponentType;
  /** Start a new visual group (hairline) before this tool. */
  groupBefore?: boolean;
}

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", hint: "V", icon: LuMousePointer2 },
  { id: "node", label: "Edit Nodes", hint: "N", icon: LuSpline },
  { id: "rect", label: "Rectangle", hint: "R", icon: LuSquare, groupBefore: true },
  { id: "ellipse", label: "Ellipse", hint: "O", icon: LuCircle },
  { id: "line", label: "Line", hint: "L", icon: LuSlash },
  { id: "pen", label: "Pen", hint: "P", icon: LuPenTool, groupBefore: true },
  { id: "brush", label: "Brush", hint: "B", icon: LuBrush },
  { id: "pencil", label: "Pencil", hint: "⇧B", icon: LuPencil },
  { id: "text", label: "Text", hint: "T", icon: LuType },
  { id: "artboard", label: "Artboard", hint: "A", icon: LuFrame, groupBefore: true },
];

export default function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <Fragment key={t.id}>
          {t.groupBefore && <span className="tool-sep" />}
          <button
            className={"tool-btn" + (tool === t.id ? " active" : "")}
            onClick={() => setTool(t.id)}
            title={`${t.label} (${t.hint})`}
            aria-label={t.label}
            aria-pressed={tool === t.id}
          >
            <span className="tool-icon" aria-hidden>
              <t.icon />
            </span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}
