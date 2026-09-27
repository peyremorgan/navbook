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

import { createUnsavedWork } from "~/utils/unsaved";

export default defineNuxtPlugin(() => {
  const work = createUnsavedWork();

  window.addEventListener("beforeunload", (event) => {
    if (work.takeAgreement() || !work.dirty()) return;
    event.preventDefault();
    // What browsers before `preventDefault` counted read instead; it has to
    // be a non-empty string, though none of them show it any more.
    event.returnValue = "unsaved";
  });

  return { provide: { unsaved: work } };
});
