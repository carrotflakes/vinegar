import { useEffect } from "react";
import { LuX } from "react-icons/lu";
import {
  isPositiveSafeInteger,
  isUiLocale,
  SUPPORTED_LOCALES,
  THEME_PREFERENCES,
  type ThemePreference,
  type UiLocale,
} from "../../preferences/model";
import { usePreferences } from "../../store/preferencesStore";
import { useDock } from "../dock/dockStore";
import "../Modal.css";
import "./PreferencesDialog.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

const THEME_LABELS: Record<ThemePreference, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

const LOCALE_LABELS: Record<UiLocale, string> = {
  en: "English",
};

const RECOVERY_INTERVAL_OPTIONS = [
  { value: 5000, label: "5 seconds" },
  { value: 15000, label: "15 seconds" },
  { value: 30000, label: "30 seconds" },
  { value: 60000, label: "1 minute" },
] as const;

const UNDO_HISTORY_LIMIT_OPTIONS = [
  { value: 50, label: "50 steps" },
  { value: 100, label: "100 steps" },
  { value: 200, label: "200 steps" },
] as const;

/** A labelled preference row: title + description on the left, control on the right. */
function Row({
  title,
  description,
  control,
}: {
  title: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="pref-row">
      <div className="pref-text">
        <span className="pref-title">{title}</span>
        {description && <span className="pref-desc">{description}</span>}
      </div>
      <div className="pref-control">{control}</div>
    </div>
  );
}

export default function PreferencesDialog({ open, onClose }: Props) {
  const general = usePreferences((state) => state.general);
  const canvas = usePreferences((state) => state.canvas);
  const recovery = usePreferences((state) => state.recovery);
  const undoHistoryLimit = usePreferences((state) => state.history.limit);
  const setTheme = usePreferences((state) => state.setTheme);
  const setLocale = usePreferences((state) => state.setLocale);
  const setCanvasRotationEnabled = usePreferences(
    (state) => state.setCanvasRotationEnabled
  );
  const setCanvasRotationSnap = usePreferences(
    (state) => state.setCanvasRotationSnap
  );
  const setRecoveryEnabled = usePreferences((state) => state.setRecoveryEnabled);
  const setRecoveryMaxWaitMs = usePreferences(
    (state) => state.setRecoveryMaxWaitMs
  );
  const setUndoHistoryLimit = usePreferences(
    (state) => state.setUndoHistoryLimit
  );
  const resetPreferences = usePreferences((state) => state.resetPreferences);
  const resetLayout = useDock((state) => state.resetLayout);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal preferences-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <span id="preferences-title">Preferences</span>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <LuX aria-hidden />
          </button>
        </div>

        <div className="preferences-body">
          <section className="pref-section">
            <h3 className="pref-section-title">General</h3>
            <Row
              title="Theme"
              description="Match the system setting or pick a fixed appearance."
              control={
                <div className="pref-segmented" role="group" aria-label="Theme">
                  {THEME_PREFERENCES.map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      className={
                        "pref-seg" + (general.theme === theme ? " active" : "")
                      }
                      aria-pressed={general.theme === theme}
                      onClick={() => setTheme(theme)}
                    >
                      {THEME_LABELS[theme]}
                    </button>
                  ))}
                </div>
              }
            />
            <Row
              title="Language"
              control={
                <select
                  className="pref-select"
                  value={general.locale}
                  disabled={SUPPORTED_LOCALES.length === 1}
                  onChange={(event) => {
                    const locale = event.target.value;
                    if (isUiLocale(locale)) setLocale(locale);
                  }}
                >
                  {SUPPORTED_LOCALES.map((locale) => (
                    <option key={locale} value={locale}>
                      {LOCALE_LABELS[locale]}
                    </option>
                  ))}
                </select>
              }
            />
          </section>

          <section className="pref-section">
            <h3 className="pref-section-title">Canvas</h3>
            <Row
              title="Canvas rotation"
              description="Rotate the view with a two-finger twist or the zoom menu."
              control={
                <button
                  type="button"
                  role="switch"
                  aria-checked={canvas.rotationEnabled}
                  className={
                    "pref-switch" + (canvas.rotationEnabled ? " on" : "")
                  }
                  onClick={() =>
                    setCanvasRotationEnabled(!canvas.rotationEnabled)
                  }
                >
                  <span className="pref-switch-knob" aria-hidden />
                </button>
              }
            />
            <Row
              title="Snap rotation to 90°"
              description="Snap the canvas to quarter turns while rotating."
              control={
                <button
                  type="button"
                  role="switch"
                  aria-checked={canvas.rotationSnap}
                  disabled={!canvas.rotationEnabled}
                  className={"pref-switch" + (canvas.rotationSnap ? " on" : "")}
                  onClick={() => setCanvasRotationSnap(!canvas.rotationSnap)}
                >
                  <span className="pref-switch-knob" aria-hidden />
                </button>
              }
            />
          </section>

          <section className="pref-section">
            <h3 className="pref-section-title">Recovery</h3>
            <Row
              title="Recovery autosave"
              description="Keep a recovery snapshot in this browser."
              control={
                <button
                  type="button"
                  role="switch"
                  aria-checked={recovery.enabled}
                  className={
                    "pref-switch" + (recovery.enabled ? " on" : "")
                  }
                  onClick={() => setRecoveryEnabled(!recovery.enabled)}
                >
                  <span className="pref-switch-knob" aria-hidden />
                </button>
              }
            />
            <Row
              title="Snapshot interval"
              description="Maximum time between browser recovery snapshots."
              control={
                <select
                  className="pref-select"
                  value={recovery.maxWaitMs}
                  disabled={!recovery.enabled}
                  onChange={(event) => {
                    const interval = Number(event.target.value);
                    if (isPositiveSafeInteger(interval)) {
                      setRecoveryMaxWaitMs(interval);
                    }
                  }}
                >
                  {!RECOVERY_INTERVAL_OPTIONS.some(
                    (option) => option.value === recovery.maxWaitMs
                  ) && (
                    <option value={recovery.maxWaitMs}>
                      {recovery.maxWaitMs} ms (custom)
                    </option>
                  )}
                  {RECOVERY_INTERVAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              }
            />
          </section>

          <section className="pref-section">
            <h3 className="pref-section-title">Workspace</h3>
            <Row
              title="Panel layout"
              description="Restore the default arrangement of the docked panels."
              control={
                <button
                  type="button"
                  className="preferences-button"
                  onClick={resetLayout}
                >
                  Reset layout
                </button>
              }
            />
          </section>

          <section className="pref-section">
            <h3 className="pref-section-title">History</h3>
            <Row
              title="Undo history limit"
              description="Maximum number of undo and redo steps kept in memory."
              control={
                <select
                  className="pref-select"
                  value={undoHistoryLimit}
                  onChange={(event) => {
                    const limit = Number(event.target.value);
                    if (isPositiveSafeInteger(limit)) setUndoHistoryLimit(limit);
                  }}
                >
                  {!UNDO_HISTORY_LIMIT_OPTIONS.some(
                    (option) => option.value === undoHistoryLimit
                  ) && (
                    <option value={undoHistoryLimit}>
                      {undoHistoryLimit} steps (custom)
                    </option>
                  )}
                  {UNDO_HISTORY_LIMIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              }
            />
          </section>
        </div>

        <div className="modal-foot preferences-foot">
          <button
            type="button"
            className="preferences-button"
            onClick={resetPreferences}
          >
            Reset to defaults
          </button>
          <button
            type="button"
            className="preferences-button primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
