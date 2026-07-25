// Document units. Geometry is stored as unitless numbers ("world units"), which
// are CSS pixels at 100% zoom; `DocumentSettings.unit`/`dpi` only change how a
// number is *presented*. Everything that labels a length (rulers today) goes
// through here so the conversion lives in one place.

import type { DocumentSettings } from "./types";

/** World units per one document unit (e.g. 3.7795… world units per mm at 96dpi). */
export function worldPerUnit(settings: DocumentSettings): number {
  const dpi = settings.dpi > 0 ? settings.dpi : 96;
  switch (settings.unit) {
    case "px": return 1;
    case "pt": return dpi / 72;
    case "in": return dpi;
    case "mm": return dpi / 25.4;
    case "cm": return dpi / 2.54;
  }
}

/** Convert a world-space length/coordinate into document units. */
export function toUnits(value: number, settings: DocumentSettings): number {
  return value / worldPerUnit(settings);
}

/** Format a value already expressed in document units for a compact label. */
export function formatUnits(value: number, step: number): string {
  // Show only as many decimals as the tick step actually needs.
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  const text = value.toFixed(decimals);
  // Avoid a "-0" label at the origin.
  return Number(text) === 0 ? (0).toFixed(decimals) : text;
}
