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
  LuEraser,
  LuPaintBucket,
  LuBlend,
  LuFrame,
  LuType,
} from "react-icons/lu";
import { useEditor, type ToolId } from "../store/editorStore";
import GeneratorFlyout from "./GeneratorFlyout";
import "./Toolbar.css";

interface ToolDef {
  id: ToolId;
  label: string;
  hint: string;
  icon: ComponentType;
  /** Start a new visual group (hairline) before this tool. */
  groupBefore?: boolean;
}

// Grouped by what a tool *does*, not by how it draws: select/edit, then the
// tools that make a shape, then the ones that draw — bucket included, since it
// grows a new path from the ink around the click rather than recolouring
// anything — then the gradient, the one tool that makes nothing and only lays
// paint on artwork that is already there, and finally the frame.
const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", hint: "V", icon: LuMousePointer2 },
  { id: "node", label: "Edit Nodes", hint: "N", icon: LuSpline },
  { id: "rect", label: "Rectangle", hint: "R", icon: LuSquare, groupBefore: true },
  { id: "ellipse", label: "Ellipse", hint: "O", icon: LuCircle },
  { id: "line", label: "Line", hint: "L", icon: LuSlash },
  { id: "text", label: "Text", hint: "T", icon: LuType },
  { id: "pen", label: "Pen", hint: "P", icon: LuPenTool, groupBefore: true },
  { id: "pencil", label: "Pencil", hint: "⇧B", icon: LuPencil },
  { id: "brush", label: "Brush", hint: "B", icon: LuBrush },
  { id: "eraser", label: "Eraser", hint: "E", icon: LuEraser },
  { id: "bucket", label: "Bucket Fill", hint: "G", icon: LuPaintBucket },
  { id: "gradient", label: "Gradient", hint: "⇧G", icon: LuBlend, groupBefore: true },
  { id: "frame", label: "Frame", hint: "A", icon: LuFrame, groupBefore: true },
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
      {/* Not a tool: opens the experimental generator flyout. */}
      <span className="tool-sep" />
      <GeneratorFlyout />
    </div>
  );
}
