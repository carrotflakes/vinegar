import { measureTextShape } from "../textLayout";
import { makeId, type TextShape, type Vec2 } from "../../model/types";
import { styleFromDefaults, type EditorState } from "../../store/editorStore";
import { CLICK_SLOP, type Interaction, type ToolContext } from "../interaction";
import { EMPTY_EXCLUDE, pointSnap } from "../picking";
import { setReadout } from "../../store/pointerStore";

export function startTextCreate(ctx: ToolContext, world: Vec2): void {
  const start = pointSnap(ctx, world, EMPTY_EXCLUDE);
  ctx.interaction.current = { kind: "text-create", start, current: start };
  ctx.scheduleDraw();
}

export function moveTextCreate(
  ctx: ToolContext,
  interaction: Extract<Interaction, { kind: "text-create" }>,
  world: Vec2
): void {
  interaction.current = pointSnap(ctx, world, EMPTY_EXCLUDE);
  const width = Math.abs(interaction.current.x - interaction.start.x);
  if (Math.hypot(
    interaction.current.x - interaction.start.x,
    interaction.current.y - interaction.start.y
  ) > CLICK_SLOP) setReadout(`W ${Math.round(width)}`);
  ctx.scheduleDraw();
}

export function finishTextCreate(
  state: EditorState,
  interaction: Extract<Interaction, { kind: "text-create" }>
): TextShape {
  const { start, current } = interaction;
  const dragged = Math.hypot(current.x - start.x, current.y - start.y) > CLICK_SLOP;
  const shape: TextShape = {
    id: makeId("text"),
    name: "Text",
    type: "text",
    text: "",
    textMode: dragged ? "area" : "point",
    x: dragged ? Math.min(start.x, current.x) : start.x,
    y: dragged ? Math.min(start.y, current.y) : start.y,
    width: dragged ? Math.max(1, Math.abs(current.x - start.x)) : 12,
    height: 28.8,
    fontFamily: "System Sans",
    fontSize: 24,
    fontWeight: 400,
    italic: false,
    lineHeight: 1.2,
    align: "left",
    ...styleFromDefaults(state.style),
  };
  return measureTextShape(shape);
}
