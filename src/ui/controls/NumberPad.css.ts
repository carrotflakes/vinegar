import { vars } from "@/styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".number-pad", {
  // Above every surface a number field can live in — panels, modals (50),
  // colour popovers (90), menus and context menus (100) — since the pad is
  // always opened from inside one of them.
  zIndex: "300",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  width: "232px",
  padding: "10px",
  background: vars.panel2,
  border: `1px solid ${vars.border}`,
  borderRadius: "9px",
  boxShadow: `0 10px 24px ${vars.shadow}`,
  // The pad is a touch surface: never let a press scroll the panel behind it.
  touchAction: "none",
  userSelect: "none",
});

globalStyle(".number-pad-head", {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "8px",
  minHeight: "14px",
  fontSize: "11px",
  color: vars.muted,
});

globalStyle(".number-pad-label", {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

globalStyle(".number-pad-range", {
  flex: "none",
  fontVariantNumeric: "tabular-nums",
});

globalStyle(".number-pad-display", {
  padding: "6px 10px",
  overflow: "hidden",
  fontSize: "20px",
  textAlign: "right",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
  color: vars.text,
  background: vars.field,
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
});

globalStyle(".number-pad-unit", {
  marginLeft: "3px",
  fontSize: "13px",
  color: vars.muted,
});

globalStyle(".number-pad-empty", {
  color: vars.muted,
});

globalStyle(".number-pad-grid", {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gridTemplateRows: "repeat(4, 1fr)",
  gap: "6px",
});

globalStyle(".number-pad-key", {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  // 44px is the smallest comfortable touch target, which is the whole point.
  minHeight: "44px",
  padding: "0",
  fontSize: "16px",
  color: vars.text,
  background: vars.panel,
  border: `1px solid ${vars.border}`,
  borderRadius: "7px",
  cursor: "pointer",
});

globalStyle(".number-pad-key:hover", {
  background: vars.hover,
});

globalStyle(".number-pad-key:active", {
  background: vars.accentWeak,
});

globalStyle(".number-pad-side", {
  color: vars.muted,
  background: vars.bg,
});

globalStyle(".number-pad-foot", {
  display: "flex",
  gap: "6px",
});

globalStyle(".number-pad-action", {
  flex: "1",
  minHeight: "36px",
  fontSize: "13px",
  color: vars.text,
  background: vars.panel,
  border: `1px solid ${vars.border}`,
  borderRadius: "7px",
  cursor: "pointer",
});

globalStyle(".number-pad-action:hover", {
  background: vars.hover,
});

globalStyle(".number-pad-action.primary", {
  color: vars.text,
  background: vars.accentSoft,
  borderColor: vars.accentBorder,
});

globalStyle(".number-pad-action:disabled", {
  opacity: "0.5",
  cursor: "default",
});
