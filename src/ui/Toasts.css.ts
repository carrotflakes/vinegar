import { globalKeyframes, style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { vars } from "../styles/theme.css";

const slideIn = "toast-slide-in";
globalKeyframes(slideIn, {
  from: { opacity: 0, transform: "translateY(8px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

// Fixed stack in the bottom-right corner, above dialogs. pointerEvents is
// disabled on the stack so it never blocks the canvas; each toast re-enables
// it for its own close button.
export const stack = style({
  position: "fixed",
  top: 16,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 1000,
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 8,
  maxWidth: "360px",
  pointerEvents: "none",
});

export const toast = recipe({
  base: {
    pointerEvents: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 13px",
    borderRadius: 10,
    background: vars.panel2,
    color: vars.text,
    fontSize: 13,
    lineHeight: 1.45,
    boxShadow: `0 8px 28px ${vars.shadow}`,
    animation: `${slideIn} 140ms ease-out`,
  },
  variants: {
    kind: {
      error: { background: vars.dangerWeak },
      success: { background: "rgba(78, 199, 122, 0.14)" },
      info: { background: vars.accentWeak },
    },
  },
});

export const icon = recipe({
  base: { flex: "none" },
  variants: {
    kind: {
      error: { color: vars.danger },
      success: { color: vars.ok },
      info: { color: vars.accent },
    },
  },
});

export const message = style({
  flex: 1,
  wordBreak: "break-word",
  whiteSpace: "pre-wrap",
});

export const close = style({
  flex: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 6,
  margin: -4,
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: vars.muted,
  cursor: "pointer",
  selectors: {
    "&:hover": { color: vars.text },
  },
});
