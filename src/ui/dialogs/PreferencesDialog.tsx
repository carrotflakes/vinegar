import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuGithub,
  LuInfo,
  LuPalette,
  LuPencilRuler,
  LuSave,
  LuWrench,
  LuX,
} from "react-icons/lu";
import {
  BUILD_INFO,
  REPOSITORY_URL,
  buildReport,
  commitUrl,
  formatBuildTime,
} from "../../buildInfo";
import {
  isPositiveSafeInteger,
  isRulerOrigin,
  NUMBER_PAD_PREFERENCES,
  RULER_ORIGINS,
  SUPPORTED_LOCALES,
  THEME_PREFERENCES,
  isUiLocale,
  type NumberPadPreference,
  type RulerOriginPreference,
  type ThemePreference,
  type UiLocale,
} from "../../preferences/model";
import { anyMenuOpen } from "../../store/menuStore";
import { usePreferences } from "../../store/preferencesStore";
import { notify } from "../../store/toastStore";
import { useDock } from "../dock/dockStore";
import "../Modal.css";
import "./DialogForm.css";
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

const RULER_ORIGIN_LABELS: Record<RulerOriginPreference, string> = {
  frame: "Active frame",
  world: "Document origin",
};

const NUMBER_PAD_LABELS: Record<NumberPadPreference, string> = {
  auto: "On touch",
  always: "Always",
  never: "Never",
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

/** The panel is one continuous scroll; the sidebar is a table of contents. */
const CATEGORIES = [
  { id: "interface", label: "Interface", icon: LuPalette },
  { id: "canvas", label: "Canvas & Editing", icon: LuPencilRuler },
  { id: "files", label: "Files & Recovery", icon: LuSave },
  { id: "advanced", label: "Advanced", icon: LuWrench },
  { id: "about", label: "About", icon: LuInfo },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

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

/** The on/off pill used by every boolean preference. */
function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled ?? false}
      className={"pref-switch" + (checked ? " on" : "")}
      onClick={() => onChange(!checked)}
    >
      <span className="pref-switch-knob" aria-hidden />
    </button>
  );
}

export default function PreferencesDialog({ open, onClose }: Props) {
  const [category, setCategory] = useState<CategoryId>("interface");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(
    {} as Partial<Record<CategoryId, HTMLElement | null>>
  );
  const general = usePreferences((state) => state.general);
  const canvas = usePreferences((state) => state.canvas);
  const input = usePreferences((state) => state.input);
  const recovery = usePreferences((state) => state.recovery);
  const undoHistoryLimit = usePreferences((state) => state.history.limit);
  const advanced = usePreferences((state) => state.advanced);
  const setTheme = usePreferences((state) => state.setTheme);
  const setLocale = usePreferences((state) => state.setLocale);
  const setCanvasRotationEnabled = usePreferences(
    (state) => state.setCanvasRotationEnabled
  );
  const setCanvasRotationSnap = usePreferences(
    (state) => state.setCanvasRotationSnap
  );
  const setRulerOrigin = usePreferences((state) => state.setRulerOrigin);
  const setFingerDrawing = usePreferences((state) => state.setFingerDrawing);
  const setShowAllHandles = usePreferences((state) => state.setShowAllHandles);
  const setNumberPad = usePreferences((state) => state.setNumberPad);
  const setRecoveryEnabled = usePreferences((state) => state.setRecoveryEnabled);
  const setRecoveryMaxWaitMs = usePreferences(
    (state) => state.setRecoveryMaxWaitMs
  );
  const setUndoHistoryLimit = usePreferences(
    (state) => state.setUndoHistoryLimit
  );
  const setDeveloperMode = usePreferences((state) => state.setDeveloperMode);
  const resetPreferences = usePreferences((state) => state.resetPreferences);
  const resetLayout = useDock((state) => state.resetLayout);

  /** Highlight the category whose heading last passed the top of the panel. */
  const syncActiveCategory = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    // A short final category can never reach the top, so once the panel is
    // scrolled to the end it always owns the highlight.
    if (body.scrollHeight - body.clientHeight - body.scrollTop < 4) {
      setCategory(CATEGORIES[CATEGORIES.length - 1].id);
      return;
    }
    let active: CategoryId = CATEGORIES[0].id;
    for (const { id } of CATEGORIES) {
      const section = sectionRefs.current[id];
      if (!section) continue;
      if (section.offsetTop > body.scrollTop + 24) break;
      active = id;
    }
    setCategory(active);
  }, []);

  useEffect(() => {
    if (!open) return;
    const body = bodyRef.current;
    if (!body) return;
    syncActiveCategory();
    body.addEventListener("scroll", syncActiveCategory, { passive: true });
    return () => body.removeEventListener("scroll", syncActiveCategory);
  }, [open, syncActiveCategory]);

  const scrollToCategory = (id: CategoryId) => {
    const body = bodyRef.current;
    const section = sectionRefs.current[id];
    if (!body || !section) return;
    body.scrollTo({ top: section.offsetTop - 12, behavior: "smooth" });
    setCategory(id);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // An open popover (a colour picker, a menu) owns Escape; let it close
      // first and keep the dialog up.
      if (anyMenuOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  /** Copy the build identity plus the user agent, for pasting into a report. */
  const copyBuildInfo = () => {
    void navigator.clipboard
      .writeText(buildReport())
      .then(() => notify.success("Build information copied."))
      .catch(() => notify.error("Could not copy the build information."));
  };

  const sections: Record<CategoryId, React.ReactNode> = {
    interface: (
      <>
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
        <Row
          title="Number pad"
          description="Tap a number field to enter a value on an in-app keypad, instead of the system keyboard."
          control={
            <div className="pref-segmented" role="group" aria-label="Number pad">
              {NUMBER_PAD_PREFERENCES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={
                    "pref-seg" + (input.numberPad === mode ? " active" : "")
                  }
                  aria-pressed={input.numberPad === mode}
                  onClick={() => setNumberPad(mode)}
                >
                  {NUMBER_PAD_LABELS[mode]}
                </button>
              ))}
            </div>
          }
        />
      </>
    ),
    canvas: (
      <>
        <Row
          title="Canvas rotation"
          description="Rotate the view with a two-finger twist or the zoom menu."
          control={
            <Switch
              label="Canvas rotation"
              checked={canvas.rotationEnabled}
              onChange={setCanvasRotationEnabled}
            />
          }
        />
        <Row
          title="Snap rotation to 90°"
          description="Snap the canvas to quarter turns while rotating."
          control={
            <Switch
              label="Snap rotation to 90°"
              checked={canvas.rotationSnap}
              disabled={!canvas.rotationEnabled}
              onChange={setCanvasRotationSnap}
            />
          }
        />
        <Row
          title="Draw with finger"
          description="Let a finger paint with the brush, pencil and eraser. Off, it only pans and pinches — turned off automatically once a pen is used."
          control={
            <Switch
              label="Draw with finger"
              checked={canvas.fingerDrawing}
              onChange={setFingerDrawing}
            />
          }
        />
        <Row
          title="Show all handles"
          description="Draw every Bézier handle while editing nodes. Off, only the handles around the selected anchors are shown — and only those can be grabbed."
          control={
            <Switch
              label="Show all handles"
              checked={canvas.showAllHandles}
              onChange={setShowAllHandles}
            />
          }
        />
        <Row
          title="Ruler origin"
          description="Count the rulers from the active frame, or always from the document origin."
          control={
            <select
              className="pref-select"
              value={canvas.rulerOrigin}
              onChange={(event) => {
                const origin = event.target.value;
                if (isRulerOrigin(origin)) setRulerOrigin(origin);
              }}
            >
              {RULER_ORIGINS.map((origin) => (
                <option key={origin} value={origin}>
                  {RULER_ORIGIN_LABELS[origin]}
                </option>
              ))}
            </select>
          }
        />
      </>
    ),
    files: (
      <>
        <Row
          title="Recovery autosave"
          description="Keep a recovery snapshot in this browser."
          control={
            <Switch
              label="Recovery autosave"
              checked={recovery.enabled}
              onChange={setRecoveryEnabled}
            />
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
      </>
    ),
    advanced: (
      <>
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
        <Row
          title="Developer mode"
          description="Show the store inspector in the app bar and on each history entry. It dumps the raw editor state, for debugging."
          control={
            <Switch
              label="Developer mode"
              checked={advanced.developerMode}
              onChange={setDeveloperMode}
            />
          }
        />
      </>
    ),
    about: (
      <>
        {/* The app's identity is a masthead rather than a labelled row: the
         * name and version are what the reader came for, and a "Version" label
         * beside the number would only repeat it. */}
        <div className="about-hero">
          <span className="about-name">Vinegar</span>
          <span className="about-version">
            {BUILD_INFO.version}
            {!BUILD_INFO.production && (
              <span className="about-tag" title="Running from the dev server">
                dev
              </span>
            )}
          </span>
        </div>
        <Row
          title="Commit"
          description="The revision this build was made from."
          control={
            commitUrl() ? (
              <a
                className="pref-build-value pref-link"
                href={commitUrl() ?? undefined}
                target="_blank"
                rel="noreferrer noopener"
              >
                {BUILD_INFO.commit}
              </a>
            ) : (
              <span className="pref-build-value">{BUILD_INFO.commit}</span>
            )
          }
        />
        <Row
          title="Built"
          control={
            <span className="pref-build-value">
              {formatBuildTime(BUILD_INFO.builtAt)}
            </span>
          }
        />
        <Row
          title="Repository"
          description="Source code, releases and the issue tracker."
          control={
            <a
              className="pref-link"
              href={REPOSITORY_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              <LuGithub aria-hidden />
              github.com/carrotflakes/vinegar
            </a>
          }
        />
        <Row
          title="Report a problem"
          description="Copy the version, commit, build time and browser details, then open an issue."
          control={
            <button
              type="button"
              className="preferences-button"
              onClick={copyBuildInfo}
            >
              Copy build info
            </button>
          }
        />
      </>
    ),
  };

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

        <div className="preferences-layout">
          <nav className="preferences-nav" aria-label="Preference categories">
            {CATEGORIES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={category === id}
                className={"pref-nav-item" + (category === id ? " active" : "")}
                onClick={() => scrollToCategory(id)}
              >
                <Icon aria-hidden />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="preferences-body" ref={bodyRef} tabIndex={0}>
            {CATEGORIES.map(({ id, label }) => (
              <section
                key={id}
                className="pref-section"
                aria-labelledby={`preferences-heading-${id}`}
                ref={(element) => {
                  sectionRefs.current[id] = element;
                }}
              >
                <h3 className="pref-section-title" id={`preferences-heading-${id}`}>
                  {label}
                </h3>
                {sections[id]}
              </section>
            ))}
          </div>
        </div>

        <div className="modal-foot preferences-foot">
          {/* Both resets are actions rather than settings, so they live beside
           * the dialog's other buttons instead of inside a category. */}
          <div className="preferences-foot-resets">
            <button
              type="button"
              className="preferences-button"
              onClick={resetPreferences}
            >
              Reset to defaults
            </button>
            <button
              type="button"
              className="preferences-button"
              onClick={resetLayout}
              title="Restore the default arrangement of the docked panels"
            >
              Reset layout
            </button>
          </div>
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
