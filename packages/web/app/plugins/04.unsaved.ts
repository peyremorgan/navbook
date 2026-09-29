/**
 * Asking before a way out throws away what somebody typed.
 *
 * There are two kinds of way out. A navigation inside the app — a sidebar
 * link, the breadcrumb, a reference followed from a preview, Back — goes
 * through the router, and `middleware/00.unsaved.global.ts` asks in the app's
 * own dialog (`LeaveDialog`). One that leaves the document — a reload, a
 * closed tab — only the browser can stop, with its `beforeunload` prompt,
 * which is this plugin's half.
 *
 * The app's own ways out of the document ask for themselves, in the dialog,
 * before they do anything that cannot be taken back: signing out
 * (`useAuth().logout`) and the redirect to the provider when the API refuses
 * the token (`plugins/03.apollo.ts`). Having asked, they `agree`, so the
 * prompt here is not shown a second time.
 *
 * Opening a link in a new tab was tried as a way round all this and is worse:
 * the token lives in `sessionStorage` (`plugins/02.auth.ts`), so the new tab
 * signs in again.
 */

import { isNavigationFailure, NavigationFailureType } from "vue-router";
import { createUnsavedWork } from "~/utils/unsaved";

export default defineNuxtPlugin((nuxtApp) => {
  const work = createUnsavedWork();

  // A yes in the dialog covers the navigation it was asked for, including a
  // redirect out of the document that navigation turns into, and no further:
  // it lapses when that navigation lands or fails. Except when it was
  // cancelled, which means a newer navigation superseded it — one the
  // middleware has already asked about, whose own yes this must not lower.
  nuxtApp.$router.afterEach((_to, _from, failure) => {
    if (isNavigationFailure(failure, NavigationFailureType.cancelled)) return;
    work.endNavigation();
  });

  window.addEventListener("beforeunload", (event) => {
    if (work.mayUnload()) return;
    event.preventDefault();
    // What browsers before `preventDefault` counted read instead; it has to
    // be a non-empty string, though none of them show it any more.
    event.returnValue = "unsaved";
  });

  return { provide: { unsaved: work } };
});
