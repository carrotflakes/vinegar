import { registerSW } from "virtual:pwa-register";
import { notify } from "./store/toastStore";

/**
 * Register the service worker that makes Vinegar launchable offline, and offer
 * a pending update as a toast.
 *
 * The worker is registered in "prompt" mode on purpose: a new build waits
 * instead of activating, so an update can never reload the app out from under a
 * drawing in progress. Reloading by hand does not pick it up either (the old
 * and new page overlap, so the waiting worker is never released) — hence the
 * toast, which is the only way to take an update without closing every window.
 *
 * In dev this is a no-op: the plugin only emits a worker for production builds.
 */
export function registerServiceWorker(): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // No timeout: an update notice must not disappear while the user is busy.
      notify.info("A new version of Vinegar is available.", null, {
        label: "Reload",
        // `true` activates the waiting worker; it reloads the page once it
        // takes control.
        run: () => void updateSW(true),
      });
    },
  });
}
