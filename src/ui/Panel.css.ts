import { vars } from "../styles/theme.css";
import { globalStyle } from "@vanilla-extract/css";

globalStyle(".geo-field > input::-webkit-outer-spin-button,\n.geo-field > input::-webkit-inner-spin-button", {
  WebkitAppearance: "none",
  margin: "0",
});

globalStyle(".panel", {
  display: "flex",
  flexDirection: "column",
});

globalStyle(".section", {
  padding: "14px",
  borderBottom: `1px solid ${vars.border}`,
  display: "flex",
  flexDirection: "column",
  gap: "12px",
});

globalStyle(".section-head", {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
});

globalStyle(".section-title", {
  fontSize: "12px",
  fontWeight: "600",
  color: vars.muted,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
});

/* A panel's own title bar (as opposed to `.section-title`, which titles one
   block inside a body). It stays put while the body scrolls past: the title
   says which panel you are looking at and carries its actions, both needed
   most in a long list — exactly when they would otherwise be scrolled away.
   The dock body is what scrolls, so this sticks to that. */
globalStyle(".panel-title", {
  position: "sticky",
  top: "0",
  zIndex: "1",
  background: vars.panel,
  padding: "12px 14px 6px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
});

/* Wrapper for a title bar that has something below it which must not scroll
   away from it either (Layers' focus breadcrumb, Generators' trust banner):
   the block sticks as a whole, and the title's own rule is then a no-op
   inside it. Panels whose title bar stands alone don't need this. */
globalStyle(".panel-header", {
  position: "sticky",
  top: "0",
  zIndex: "1",
  background: vars.panel,
});

/* Trailing title action (e.g. Swatches' "add"): don't let the 22px button
   inflate the title row past its plain-text height in other panels. */
globalStyle(".title-add", {
  flex: "none",
  marginBlock: "-6px",
});

/* Several trailing actions: they keep the title's plain-text height the same
   way `title-add` does, but stay grouped at the end rather than being spread
   out by the title's space-between. */
globalStyle(".title-actions", {
  flex: "none",
  display: "flex",
  alignItems: "center",
  gap: "2px",
  marginBlock: "-6px",
});

globalStyle(".field", {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
});

globalStyle(".field > label", {
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".field-row", {
  display: "flex",
  alignItems: "center",
  gap: "8px",
});

globalStyle(".field-row input[type=\"range\"]", {
  flex: "1",
});

/* Compact single-row field: label on the left, control on the right. Used to
 * keep the properties dock dense now that sliders are gone. */
globalStyle(".field-inline", {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
});

globalStyle(".field-inline > label", {
  fontSize: "12px",
  color: vars.muted,
});

globalStyle(".num-suffix", {
  display: "flex",
  alignItems: "center",
  gap: "4px",
});

globalStyle(".field-row input[type=\"color\"],\n.field-inline input[type=\"color\"]", {
  width: "30px",
  height: "26px",
  padding: "0",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  background: "none",
});

globalStyle(".stroke-presets .ghost-btn", {
  minWidth: "0",
  paddingInline: "8px",
});

globalStyle(".btn-row", {
  display: "flex",
  gap: "6px",
});

/* Equal-width split is a property of the button row, not the button itself,
 * so a lone .ghost-btn placed elsewhere sizes to its content. */
globalStyle(".btn-row .ghost-btn", {
  flex: "1",
});

globalStyle(".ghost-btn", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  padding: "4px 8px",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  background: vars.panel,
  color: vars.text,
  fontSize: "12px",
});

globalStyle(".ghost-btn:hover:not(:disabled)", {
  background: vars.bg,
});

globalStyle(".ghost-btn:disabled", {
  opacity: "0.45",
  cursor: "default",
});

globalStyle(".ghost-btn.danger", {
  color: vars.danger,
  borderColor: vars.dangerBorder,
});

globalStyle(".ghost-btn.danger:hover", {
  background: vars.dangerWeak,
});

globalStyle(".icon-btn", {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "26px",
  height: "26px",
  padding: "0",
  border: `1px solid ${vars.border}`,
  borderRadius: "6px",
  background: vars.panel,
  color: vars.muted,
});

globalStyle(".icon-btn:hover", {
  background: vars.bg,
  color: vars.text,
});
