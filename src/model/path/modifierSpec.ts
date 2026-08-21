import { PATH_MODIFIER_TYPES, type PathModifier } from "../types";

// ===========================================================================
// What each modifier stage *is*: its name and its parameters. One declaration
// per type, read by the properties panel (which fields to render), the
// parameter bindings (which fields a document number may drive, and how far
// down they may go), the file validator and the "add modifier" defaults.
//
// Only the geometry stays elsewhere: `applyModifier` in pathModifiers.ts is
// the one other place that switches on the type, and the compiler checks that
// switch for exhaustiveness. Adding a stage means a union member, an entry
// here and a case there — `tests/modifierSpec.test.mjs` holds the three sides
// together.
// ===========================================================================

export interface ModifierNumberField {
  kind: "number";
  key: string;
  label: string;
  default: number;
  /** Inclusive lower bound: rejected on load, clamped in the panel. */
  min?: number;
  step?: number;
  /** Edited and stored as a whole number (a PRNG seed). */
  integer?: boolean;
}

export interface ModifierChoiceField {
  kind: "choice";
  key: string;
  label: string;
  default: string;
  options: readonly { value: string; label: string }[];
}

export type ModifierField = ModifierNumberField | ModifierChoiceField;

export interface ModifierSpec {
  label: string;
  fields: readonly ModifierField[];
}

const JOIN_OPTIONS = [
  { value: "miter", label: "Miter" },
  { value: "round", label: "Round" },
  { value: "bevel", label: "Bevel" },
] as const;

const CAP_OPTIONS = [
  { value: "butt", label: "Butt" },
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
] as const;

const POINT_OPTIONS = [
  { value: "corner", label: "Corner" },
  { value: "smooth", label: "Smooth" },
] as const;

const tolerance = (value: number): ModifierNumberField => ({
  kind: "number", key: "tolerance", label: "Tolerance", default: value,
  min: 0, step: 0.1,
});

/** Spacing between the points a resampling stage generates. */
const spacing = (value: number): ModifierNumberField => ({
  kind: "number", key: "detail", label: "Spacing", default: value,
  min: 0.1, step: 0.1,
});

export const PATH_MODIFIER_SPECS: Record<PathModifier["type"], ModifierSpec> = {
  simplify: { label: "Simplify", fields: [tolerance(2.5)] },
  flatten: { label: "Flatten", fields: [tolerance(0.5)] },
  offset: {
    label: "Offset",
    fields: [
      { kind: "number", key: "distance", label: "Distance", default: 10, step: 0.1 },
      { kind: "choice", key: "join", label: "Join", default: "round", options: JOIN_OPTIONS },
    ],
  },
  outline: {
    label: "Outline",
    fields: [
      { kind: "number", key: "width", label: "Width", default: 10, min: 0, step: 0.1 },
      { kind: "choice", key: "cap", label: "Cap", default: "round", options: CAP_OPTIONS },
      { kind: "choice", key: "join", label: "Join", default: "round", options: JOIN_OPTIONS },
    ],
  },
  round: {
    label: "Round corners",
    fields: [
      { kind: "number", key: "radius", label: "Radius", default: 8, min: 0, step: 0.1 },
    ],
  },
  zigzag: {
    label: "Zig zag / Wave",
    fields: [
      { kind: "number", key: "amplitude", label: "Size", default: 6, step: 0.1 },
      {
        kind: "number", key: "wavelength", label: "Spacing", default: 24,
        min: 0.1, step: 0.1,
      },
      { kind: "choice", key: "style", label: "Points", default: "corner", options: POINT_OPTIONS },
    ],
  },
  roughen: {
    label: "Roughen",
    fields: [
      { kind: "number", key: "size", label: "Size", default: 4, min: 0, step: 0.1 },
      spacing(12),
      { kind: "number", key: "seed", label: "Seed", default: 1, min: 0, step: 1, integer: true },
      { kind: "choice", key: "style", label: "Points", default: "corner", options: POINT_OPTIONS },
    ],
  },
  smooth: { label: "Smooth", fields: [] },
  reverse: { label: "Reverse", fields: [] },
};

/** Display name of each stage, shared by the panel and the menu commands. */
export const PATH_MODIFIER_LABELS = Object.fromEntries(
  PATH_MODIFIER_TYPES.map((type) => [type, PATH_MODIFIER_SPECS[type].label])
) as Record<PathModifier["type"], string>;

/** A fresh stage of the given type, with every field at its default. */
export function defaultPathModifier(type: PathModifier["type"]): PathModifier {
  const modifier: Record<string, unknown> = { type, enabled: true };
  for (const field of PATH_MODIFIER_SPECS[type].fields) {
    modifier[field.key] = field.default;
  }
  return modifier as unknown as PathModifier;
}

/** The stage's number field with this key, if it has one. */
export function modifierNumberField(
  type: PathModifier["type"],
  key: string
): ModifierNumberField | null {
  const field = PATH_MODIFIER_SPECS[type].fields
    .find((entry) => entry.key === key);
  return field?.kind === "number" ? field : null;
}

/** Bring a number inside the field's bounds and shape (used on every edit). */
export function clampFieldValue(field: ModifierNumberField, value: number): number {
  const bounded = field.min === undefined ? value : Math.max(field.min, value);
  return field.integer ? Math.round(bounded) : bounded;
}

/**
 * Whether a persisted value is a well-formed stage. The field table is the
 * schema, so a new stage type is validated the moment it is declared.
 */
export function isValidPathModifier(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (!PATH_MODIFIER_TYPES.includes(entry.type as never)) return false;
  if (typeof entry.enabled !== "boolean") return false;
  return PATH_MODIFIER_SPECS[entry.type as PathModifier["type"]].fields.every(
    (field) => {
      const held = entry[field.key];
      if (field.kind === "choice") {
        return field.options.some((option) => option.value === held);
      }
      return typeof held === "number" && Number.isFinite(held) &&
        (field.min === undefined || held >= field.min);
    }
  );
}
