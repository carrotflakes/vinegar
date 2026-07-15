export const PREFERENCES_STORAGE_KEY = "vinegar.preferences";
export const PREFERENCES_VERSION = 1 as const;

export const THEME_PREFERENCES = ["dark", "light", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const SUPPORTED_LOCALES = ["en"] as const;
export type UiLocale = (typeof SUPPORTED_LOCALES)[number];

export interface PreferencesV1 {
  version: typeof PREFERENCES_VERSION;
  general: {
    theme: ThemePreference;
    locale: UiLocale;
  };
  canvas: {
    /** Whether two-finger twist / the zoom-menu control can rotate the canvas. */
    rotationEnabled: boolean;
    /** Snap canvas rotation to the nearest quarter turn while twisting. */
    rotationSnap: boolean;
  };
  recovery: {
    enabled: boolean;
    maxWaitMs: number;
  };
  history: {
    limit: number;
  };
}

export interface PreferencesStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export type EffectiveTheme = "dark" | "light";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" &&
    THEME_PREFERENCES.some((theme) => theme === value);
}

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" &&
    SUPPORTED_LOCALES.some((locale) => locale === value);
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function createDefaultPreferences(): PreferencesV1 {
  return {
    version: PREFERENCES_VERSION,
    general: {
      theme: "system",
      locale: "en",
    },
    canvas: {
      rotationEnabled: true,
      rotationSnap: true,
    },
    recovery: {
      enabled: true,
      maxWaitMs: 5000,
    },
    history: {
      limit: 100,
    },
  };
}

function validateV1(value: Record<string, unknown>): PreferencesV1 {
  const defaults = createDefaultPreferences();
  const general = isObject(value.general) ? value.general : {};
  const canvas = isObject(value.canvas) ? value.canvas : {};
  const recovery = isObject(value.recovery) ? value.recovery : {};
  const history = isObject(value.history) ? value.history : {};

  return {
    version: PREFERENCES_VERSION,
    general: {
      theme: isThemePreference(general.theme)
        ? general.theme
        : defaults.general.theme,
      locale: isUiLocale(general.locale)
        ? general.locale
        : defaults.general.locale,
    },
    canvas: {
      rotationEnabled: typeof canvas.rotationEnabled === "boolean"
        ? canvas.rotationEnabled
        : defaults.canvas.rotationEnabled,
      rotationSnap: typeof canvas.rotationSnap === "boolean"
        ? canvas.rotationSnap
        : defaults.canvas.rotationSnap,
    },
    recovery: {
      enabled: typeof recovery.enabled === "boolean"
        ? recovery.enabled
        : defaults.recovery.enabled,
      maxWaitMs: isPositiveSafeInteger(recovery.maxWaitMs)
        ? recovery.maxWaitMs
        : defaults.recovery.maxWaitMs,
    },
    history: {
      limit: isPositiveSafeInteger(history.limit)
        ? history.limit
        : defaults.history.limit,
    },
  };
}

/** Normalize persisted preferences and provide the version migration entry point. */
export function migratePreferences(value: unknown): PreferencesV1 {
  if (!isObject(value)) return createDefaultPreferences();

  switch (value.version) {
    case PREFERENCES_VERSION:
      return validateV1(value);
    default:
      return createDefaultPreferences();
  }
}

export function parsePreferences(raw: string | null): PreferencesV1 {
  if (raw === null) return createDefaultPreferences();
  try {
    return migratePreferences(JSON.parse(raw));
  } catch {
    return createDefaultPreferences();
  }
}

function browserStorage(): PreferencesStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readPreferences(
  storage: PreferencesStorage | undefined = browserStorage()
): PreferencesV1 {
  if (!storage) return createDefaultPreferences();
  try {
    return parsePreferences(storage.getItem(PREFERENCES_STORAGE_KEY));
  } catch {
    return createDefaultPreferences();
  }
}

export function writePreferences(
  preferences: PreferencesV1,
  storage: PreferencesStorage | undefined = browserStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences remain usable in memory when browser storage is unavailable.
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean
): EffectiveTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}
