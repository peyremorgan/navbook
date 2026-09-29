/**
 * Asking before a navigation inside the app throws away unsaved work.
 *
 * A middleware rather than a plugin's `router.beforeEach`, and named to sort
 * first: global middleware runs in name order, and the question has to come
 * before `auth.global`, which would otherwise renew a token — or, with none
 * left to renew, redirect to the provider — for a navigation the person is
 * about to refuse.
 *
 * Only a change of path is asked about. The query is a page's own state — a
 * pull request's tab, a listing's filter — and changing it keeps the page and
 * its drafts mounted. A new path does not, even onto the same page component:
 * `/issues/a` to `/issues/b` is a fresh instance, which is why this is global
 * rather than each page's `onBeforeRouteLeave`, which such an update would not
 * reach. The other half — reloads, closed tabs — is `plugins/04.unsaved.ts`.
 */

export default defineNuxtRouteMiddleware(async (to, from) => {
  const work = useNuxtApp().$unsaved;
  // Any navigation begun while the question is open supersedes the one it
  // was asked for, so that one's dialog must not stay up to answer nothing.
  if (work.asking.value) work.answer(false);
  if (work.takeAgreement()) return;
  // Signing out asked already, before it dropped the token, and spent its
  // agreement on the redirect to the provider's end-session endpoint. When
  // the page comes back without having left — Back from the provider,
  // restored from the back-forward cache — it goes on to `/signed-out`
  // through here, and asking again would offer to keep editing on a page
  // whose token is already gone.
  if (useAuth().signingOut()) return;
  if (to.path === from.path || !work.dirty()) return;
  if (!(await work.confirmLeave())) return abortNavigation();
  // Held until this navigation settles, since `auth.global` may yet turn it
  // into the redirect to the provider, and the browser would ask again.
  work.agreeToNavigation();
});
