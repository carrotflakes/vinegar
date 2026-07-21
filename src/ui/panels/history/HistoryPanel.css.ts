import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../../../styles/theme.css";

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
  flex: "1",
  minWidth: "0",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "12px",
});

globalStyle(".history-inspect", {
  display: "grid",
  placeItems: "center",
  flex: "none",
  width: "20px",
  height: "20px",
  padding: "0",
  border: "none",
  borderRadius: "4px",
  color: "inherit",
  background: "transparent",
  cursor: "pointer",
  opacity: "0.45",
});

globalStyle(".history-inspect:hover, .history-inspect:focus-visible", {
  background: vars.accentWeak,
  opacity: "1",
});

globalStyle(".history-inspect svg", {
  width: "13px",
  height: "13px",
});
