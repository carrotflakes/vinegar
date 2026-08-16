// Build identity, for the About section of Preferences and for bug reports.
// The three constants are injected by `define` in vite.config.ts; this module
// is the only place that reads them, so nothing else has to know they are
// compile-time literals.

export interface BuildInfo {
  /** `version` from package.json. */
  version: string;
  /** Short commit hash, `-dirty` suffixed, or "unknown" without git. */
  commit: string;
  /** ISO timestamp of when the bundle was built. */
  builtAt: string;
  /** False for `pnpm dev`, where `builtAt` is only the server start time. */
  production: boolean;
}

/** Where the source (and the issue tracker) lives. */
export const REPOSITORY_URL = "https://github.com/carrotflakes/vinegar";

export const BUILD_INFO: BuildInfo = {
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
  builtAt: __BUILD_TIME__,
  production: import.meta.env.PROD,
};

/** The build time in the reader's locale; the raw value if it fails to parse. */
export function formatBuildTime(isoTime: string): string {
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return isoTime;
  return date.toLocaleString();
}

/**
 * The GitHub page for a build's commit, or null when there is nothing to link:
 * no git at build time, or a dirty tree whose contents were never pushed.
 */
export function commitUrl(info: BuildInfo = BUILD_INFO): string | null {
  if (info.commit === "unknown" || info.commit.endsWith("-dirty")) return null;
  return `${REPOSITORY_URL}/commit/${info.commit}`;
}

/** One line naming the build, e.g. `0.1.0 (a1b2c3d)` — the AppBar-sized form. */
export function buildLabel(info: BuildInfo = BUILD_INFO): string {
  const suffix = info.production ? "" : " dev";
  return `${info.version} (${info.commit})${suffix}`;
}

/** The block copied by the About section's copy button, for issue reports. */
export function buildReport(info: BuildInfo = BUILD_INFO): string {
  return [
    `Vinegar ${info.version}`,
    `Commit: ${info.commit}`,
    `Built: ${info.builtAt}${info.production ? "" : " (dev server start)"}`,
    `User agent: ${navigator.userAgent}`,
  ].join("\n");
}
