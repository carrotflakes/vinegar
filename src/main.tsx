import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  clearDocumentRecovery,
  restoreRecoveryAtStartup,
} from "./io/recovery";
import { startPreferenceEffects } from "./preferences/apply";
import { usePreferences } from "./store/preferencesStore";
import "./styles/index";

async function main() {
  // Apply appearance before waiting on IndexedDB recovery, so the first render
  // already uses the persisted theme and language.
  const stopPreferenceEffects = startPreferenceEffects();
  if (import.meta.hot) import.meta.hot.dispose(stopPreferenceEffects);

  // Recovery is resolved before the first paint so the user never sees an
  // empty document flash before their work is restored. When recovery is off we
  // drop any leftover snapshot here: App's toggle effect only clears on a live
  // enabled -> disabled transition, not on a session that starts disabled.
  if (usePreferences.getState().recovery.enabled) {
    await restoreRecoveryAtStartup();
  } else {
    await clearDocumentRecovery();
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void main();
