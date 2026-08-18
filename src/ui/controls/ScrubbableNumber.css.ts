import { vars } from "@/styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

/* Wrapper used only when a unit is shown: the unit is painted inside the
 * field's own padding, so the field keeps the width the caller gave it and
 * rows stay aligned whether or not they carry a unit. */
globalStyle(".scrub-field", {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  minWidth: "0",
});

globalStyle(".scrub-unit", {
  position: "absolute",
  right: "6px",
  // The field below owns the gesture; the unit must never swallow a scrub.
  pointerEvents: "none",
  color: vars.muted,
  fontSize: "11px",
  lineHeight: "1",
});
