import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../styles/theme.css";

globalStyle(".history-row", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "5px 8px",
  borderRadius: "7px",
  color: vars.text,
  cursor: "pointer",
  userSelect: "none",
});

globalStyle(".history-row:hover", {
  background: vars.bg,
});

globalStyle(".history-row.current", {
  background: vars.accentWeak,
});

/* Undone steps ahead of the current point read as dimmed but still replayable. */
globalStyle(".history-row.future", {
  color: vars.muted,
});

globalStyle(".history-dot", {
  flex: "none",
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: "currentColor",
  opacity: "0.5",
});

globalStyle(".history-row.current .history-dot", {
  opacity: "1",
});

globalStyle(".history-label", {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "12px",
});
