import { create } from "zustand";
import {
  createDefaultPreferences,
  isPositiveSafeInteger,
  readPreferences,
  writePreferences,
  type NumberPadPreference,
  type PreferencesStorage,
  type PreferencesV1,
  type RulerOriginPreference,
  type ThemePreference,
  type UiLocale,
} from "../preferences/model";

export interface PreferencesActions {
  setTheme: (theme: ThemePreference) => void;
  setLocale: (locale: UiLocale) => void;
  setCanvasRotationEnabled: (enabled: boolean) => void;
  setCanvasRotationSnap: (snap: boolean) => void;
  setRulerOrigin: (origin: RulerOriginPreference) => void;
  setFingerDrawing: (enabled: boolean) => void;
  setShowAllHandles: (enabled: boolean) => void;
  /**
   * Record that a pen contact was seen. The first one switches finger drawing
   * off, so an iPad user who picks up a stylus stops painting with their palm
   * or thumb. Returns true exactly once — when that switch happened — so the
   * caller can tell the user about it.
   */
  notePenInput: () => boolean;
  setNumberPad: (mode: NumberPadPreference) => void;
  setRecoveryEnabled: (enabled: boolean) => void;
  setRecoveryMaxWaitMs: (maxWaitMs: number) => void;
  setUndoHistoryLimit: (limit: number) => void;
  setDeveloperMode: (enabled: boolean) => void;
  resetPreferences: () => void;
}

export type PreferencesState = PreferencesV1 & PreferencesActions;

/** Extract the persisted data fields, dropping the action functions. */
function snapshot(state: PreferencesState): PreferencesV1 {
  return {
    version: state.version,
    general: state.general,
    canvas: state.canvas,
    input: state.input,
    recovery: state.recovery,
    history: state.history,
    advanced: state.advanced,
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
      setRulerOrigin: (rulerOrigin) =>
        patch("canvas", { ...get().canvas, rulerOrigin }),
      setFingerDrawing: (fingerDrawing) =>
        patch("canvas", { ...get().canvas, fingerDrawing }),
      setShowAllHandles: (showAllHandles) =>
        patch("canvas", { ...get().canvas, showAllHandles }),
      notePenInput: () => {
        const canvas = get().canvas;
        if (canvas.penDetected) return false;
        const autoDisabled = canvas.fingerDrawing;
        patch("canvas", {
          ...canvas,
          penDetected: true,
          fingerDrawing: false,
        });
        return autoDisabled;
      },
      setNumberPad: (numberPad) => patch("input", { ...get().input, numberPad }),
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
      setDeveloperMode: (developerMode) =>
        patch("advanced", { ...get().advanced, developerMode }),
      resetPreferences: () => commit(createDefaultPreferences()),
    };
  });
}

export const usePreferences = createPreferencesStore();
