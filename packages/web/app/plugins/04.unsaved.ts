/**
 * Asking before a way out throws away what somebody typed.
 *
 * Two guards, because there are two kinds of way out. A navigation inside the
 * app — a sidebar link, the breadcrumb, a reference followed from a preview,
 * Back — goes through the router, and waits there on the app's own dialog
 * (`LeaveDialog`). One that leaves the document — a reload, a closed tab, the
 * redirect to the identity provider when a save comes back UNAUTHENTICATED
 * (`plugins/03.apollo.ts`) — only the browser can stop, with its
 * `beforeunload` prompt. Signing out asks for itself (`useAuth().logout`),
 * before the token goes, so that staying keeps the session too.
 *
 * Only a change of path is asked about. The query is a page's own state — a
 * pull request's tab, a listing's filter — and changing it keeps the page and
 * its drafts mounted. A new path does not, even onto the same page component:
 * `/issues/a` to `/issues/b` is a fresh instance, which is why this is a
 * global guard rather than each page's `onBeforeRouteLeave`, which such an
 * update would not reach.
 *
 * Opening a link in a new tab was tried as a way round this and is worse:
 * the token lives in `sessionStorage` (`plugins/02.auth.ts`), so the new tab
 * signs in again.
 */

import { createUnsavedWork } from "~/utils/unsaved";

export default defineNuxtPlugin(() => {
  const work = createUnsavedWork();
  const router = useRouter();

  router.beforeEach(async (to, from) => {
    if (to.path === from.path || !work.dirty()) return true;
    return await work.confirmLeave();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!work.dirty()) return;
    event.preventDefault();
    // Still what some browsers read, rather than `preventDefault`.
    event.returnValue = "";
  });

  return { provide: { unsaved: work } };
});
