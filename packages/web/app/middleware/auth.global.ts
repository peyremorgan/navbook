/**
 * Nothing here is readable without a token, so nothing here is reachable
 * without one.
 *
 * The API refuses every operation from an unauthenticated caller, so a page
 * rendered for one would be a page of error toasts. Sending them to the
 * provider instead is both kinder and the only useful thing to do — and the
 * route they were heading for is carried along, so they land where they meant
 * to rather than at the front page.
 */

export default defineNuxtRouteMiddleware(async (to) => {
  // Two routes are exempt, for opposite reasons. `/auth/callback` is where
  // signing in finishes, and guarding it would send anyone completing a
  // sign-in back to the provider to start another. `/signed-out` is where
  // signing out lands, and guarding it would undo the signing out.
  if (to.path === "/auth/callback" || to.path === "/signed-out") return;

  const auth = useAuth();
  if (auth.signedIn.value) return;
  // A stored token survives a reload, and a spent one can often be renewed
  // from its refresh token, so both are tried before anybody is redirected.
  if ((await auth.getAccessToken()) !== null) return;

  await auth.login(to.fullPath);
  return abortNavigation();
});
