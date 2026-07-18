import { globalStyle } from "@vanilla-extract/css";
import { vars } from "../../styles/theme.css";

globalStyle(".preferences-modal", {
  width: "min(460px, calc(100vw - 32px))",
});

globalStyle(".preferences-body", {
  display: "flex",
  flexDirection: "column",
  gap: "22px",
  padding: "18px 16px",
  maxHeight: "min(70vh, 560px)",
  overflowY: "auto",
});

/* --- Sections ----------------------------------------------------------- */

globalStyle(".pref-section", {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
});

globalStyle(".pref-section-title", {
  margin: "0 0 4px",
  color: vars.muted,
  fontSize: "11px",
  fontWeight: "600",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
});

globalStyle(".preferences-foot", {
  justifyContent: "space-between",
});
