import { create } from "zustand";

// Visibility of app-level dialogs that live outside the editor document state.
// Keeping these here (rather than as React state in App) lets command-registry
// entries open them, so a dialog can be reached from the menu, a shortcut and
// the command palette through the same single source of truth.
export interface UiState {
  preferencesOpen: boolean;
  openPreferences: () => void;
  closePreferences: () => void;
  exportOpen: boolean;
  openExport: () => void;
  closeExport: () => void;
  /** Generators authoring dialog; `generatorsFocusId` preselects a script. */
  generatorsOpen: boolean;
  generatorsFocusId: string | null;
  openGenerators: (focusId?: string) => void;
  closeGenerators: () => void;
}

export const useUi = create<UiState>((set) => ({
  preferencesOpen: false,
  openPreferences: () => set({ preferencesOpen: true }),
  closePreferences: () => set({ preferencesOpen: false }),
  exportOpen: false,
  openExport: () => set({ exportOpen: true }),
  closeExport: () => set({ exportOpen: false }),
  generatorsOpen: false,
  generatorsFocusId: null,
  openGenerators: (focusId) =>
    set({ generatorsOpen: true, generatorsFocusId: focusId ?? null }),
  closeGenerators: () => set({ generatorsOpen: false, generatorsFocusId: null }),
}));
