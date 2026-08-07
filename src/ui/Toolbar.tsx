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
import { useEditor } from "../store/editorStore";
import {
  TOOL_DEFINITIONS,
  toolShortcutHint,
  toolStartsGroup,
  type ToolId,
} from "../toolDefinitions";
import GeneratorFlyout from "./GeneratorFlyout";
import "./Toolbar.css";

const TOOL_ICONS: Record<ToolId, ComponentType> = {
  select: LuMousePointer2,
  node: LuSpline,
  rect: LuSquare,
  ellipse: LuCircle,
  line: LuSlash,
  text: LuType,
  pen: LuPenTool,
  pencil: LuPencil,
  brush: LuBrush,
  eraser: LuEraser,
  bucket: LuPaintBucket,
  gradient: LuBlend,
  frame: LuFrame,
};

export default function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {TOOL_DEFINITIONS.map((definition) => {
        const Icon = TOOL_ICONS[definition.id];
        return (
          <Fragment key={definition.id}>
            {toolStartsGroup(definition) && <span className="tool-sep" />}
            <button
              className={"tool-btn" + (tool === definition.id ? " active" : "")}
              onClick={() => setTool(definition.id)}
              title={`${definition.label} (${toolShortcutHint(definition)})`}
              aria-label={definition.label}
              aria-pressed={tool === definition.id}
            >
              <span className="tool-icon" aria-hidden>
                <Icon />
              </span>
            </button>
          </Fragment>
        );
      })}
      {/* Not a tool: opens the experimental generator flyout. */}
      <span className="tool-sep" />
      <GeneratorFlyout />
    </div>
  );
}
