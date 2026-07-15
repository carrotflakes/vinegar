import { create } from "zustand";
import {
  createDefaultPreferences,
  isPositiveSafeInteger,
  readPreferences,
  writePreferences,
  type PreferencesStorage,
  type PreferencesV1,
  type ThemePreference,
  type UiLocale,
} from "../preferences/model";

export interface PreferencesActions {
  setTheme: (theme: ThemePreference) => void;
  setLocale: (locale: UiLocale) => void;
  setCanvasRotationEnabled: (enabled: boolean) => void;
  setCanvasRotationSnap: (snap: boolean) => void;
  setRecoveryEnabled: (enabled: boolean) => void;
  setRecoveryMaxWaitMs: (maxWaitMs: number) => void;
  setUndoHistoryLimit: (limit: number) => void;
  resetPreferences: () => void;
}

export type PreferencesState = PreferencesV1 & PreferencesActions;

/** Extract the persisted data fields, dropping the action functions. */
function snapshot(state: PreferencesState): PreferencesV1 {
  return {
    version: state.version,
    general: state.general,
    canvas: state.canvas,
    recovery: state.recovery,
    history: state.history,
  };
}

export function createPreferencesStore(storage?: PreferencesStorage) {
  return create<PreferencesState>((set, get) => {
    const commit = (preferences: PreferencesV1) => {
      writePreferences(preferences, storage);
      set(preferences);
    };

    // Replace a single preference group, keeping the *references* of the
    // untouched groups intact. `startPreferenceEffects` relies on this: it only
    // re-applies theme/locale when `state.general` changes identity, so setters
    // for other groups must not allocate a fresh `general` object.
    const patch = <K extends keyof PreferencesV1>(
      key: K,
      value: PreferencesV1[K]
    ) => commit({ ...snapshot(get()), [key]: value });

    return {
      ...readPreferences(storage),
      setTheme: (theme) => patch("general", { ...get().general, theme }),
      setLocale: (locale) => patch("general", { ...get().general, locale }),
      setCanvasRotationEnabled: (enabled) =>
        patch("canvas", { ...get().canvas, rotationEnabled: enabled }),
      setCanvasRotationSnap: (snap) =>
        patch("canvas", { ...get().canvas, rotationSnap: snap }),
      setRecoveryEnabled: (enabled) =>
        patch("recovery", { ...get().recovery, enabled }),
      setRecoveryMaxWaitMs: (maxWaitMs) => {
        if (!isPositiveSafeInteger(maxWaitMs)) return;
        patch("recovery", { ...get().recovery, maxWaitMs });
      },
      setUndoHistoryLimit: (limit) => {
        if (!isPositiveSafeInteger(limit)) return;
        patch("history", { limit });
      },
      resetPreferences: () => commit(createDefaultPreferences()),
    };
  });
}

export const usePreferences = createPreferencesStore();
