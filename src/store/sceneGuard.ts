// The store-side gate on `sceneValidation`'s structural invariants.
//
// Every slice checks a candidate document before committing it, and a document
// that breaks an invariant is dropped. Dropping it is correct — a malformed
// scene is worse than a missing edit — but it is *silent*: to the user, and to
// whoever is writing the slice, the action simply does nothing. Routing those
// checks through here gives developer mode something to report, while normal
// use keeps the quiet behaviour.

import { sceneContainerViolation } from "../model/sceneValidation";
import type { Document } from "../model/types";
import { usePreferences } from "./preferencesStore";
import { notify } from "./toastStore";

export interface SceneGuardOptions {
  /**
   * Pass false where the caller already tells the user why the edit was
   * refused, so developer mode adds the console detail without a second toast.
   */
  toast?: boolean;
}

/**
 * Whether `doc` may be committed. In developer mode a rejection raises a toast
 * and a console warning naming the broken invariant; the console entry carries
 * the offending document and a stack, which is what identifies the caller.
 */
export function acceptsScene(
  doc: Document,
  context?: string,
  options: SceneGuardOptions = {}
): boolean {
  const violation = sceneContainerViolation(doc);
  if (violation === null) return true;
  if (usePreferences.getState().advanced.developerMode) {
    const where = context ? ` (${context})` : "";
    if (options.toast !== false) {
      // Errors linger until dismissed by hand, and a rejected edit can repeat
      // once per pointer move — so this one gets an explicit lifetime.
      notify.error(`Edit rejected${where}: ${violation}.`, 8000);
    }
    console.warn(
      `[vinegar] rejected an invalid document${where}: ${violation}`,
      doc
    );
  }
  return false;
}
