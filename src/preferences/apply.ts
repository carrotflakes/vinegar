import { resolveTheme, type PreferencesV1 } from "./model";
import { usePreferences } from "../store/preferencesStore";

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function applyPreferencesToRoot(
  root: HTMLElement,
  preferences: PreferencesV1,
  systemPrefersDark: boolean
): void {
  root.dataset.theme = resolveTheme(
    preferences.general.theme,
    systemPrefersDark
  );
  root.lang = preferences.general.locale;
}

/** Apply global preferences immediately and keep theme/locale changes live. */
export function startPreferenceEffects(): () => void {
  if (typeof document === "undefined") return () => {};

  const root = document.documentElement;
  const media = typeof matchMedia === "function"
    ? matchMedia(COLOR_SCHEME_QUERY)
    : null;
  const apply = () => {
    applyPreferencesToRoot(
      root,
      usePreferences.getState(),
      media?.matches ?? true
    );
  };

  apply();
  const unsubscribe = usePreferences.subscribe((state, previous) => {
    if (state.general !== previous.general) apply();
  });
  const onColorSchemeChange = () => {
    if (usePreferences.getState().general.theme === "system") apply();
  };
  media?.addEventListener("change", onColorSchemeChange);

  return () => {
    unsubscribe();
    media?.removeEventListener("change", onColorSchemeChange);
  };
}
