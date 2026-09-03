/**
 * Signing in, and staying signed in.
 *
 * The API verifies an OIDC bearer token on every operation and takes the
 * person acting from its `email` claim — that is the non-committer gateway of
 * spec 06 §6.2, and the reason `author:` is data rather than derived from
 * whoever the machine account happens to be. So this client's whole account
 * system is: hold a valid access token, and put it on every request.
 *
 * Authorization code with PKCE, because a static bundle has no secret to
 * keep. Renewal is by refresh token only; the silent-iframe variant depends on
 * third-party cookies that browsers no longer send, and failing loudly with a
 * redirect is better than failing silently in a hidden frame.
 *
 * The token is kept in `sessionStorage`: it goes when the tab does, which is
 * the right lifetime for a credential that commits to a repository on your
 * behalf, and it keeps a reload from bouncing through the provider.
 */

import { type User, UserManager, WebStorageStateStore } from "oidc-client-ts";

export default defineNuxtPlugin((nuxtApp) => {
  const config = nuxtApp.$navConfig;
  const origin = window.location.origin;

  const manager = new UserManager({
    authority: config.oidc.issuer,
    client_id: config.oidc.clientId,
    redirect_uri: `${origin}/auth/callback`,
    post_logout_redirect_uri: origin,
    response_type: "code",
    scope: "openid profile email offline_access",
    // Providers that mint API tokens want to be told which API. Ones that do
    // not simply ignore it, so it is safe to send either way.
    extraQueryParams: { audience: config.oidc.audience },
    automaticSilentRenew: true,
    // A hidden iframe renew needs third-party cookies. Refresh tokens do not.
    silentRequestTimeoutInSeconds: 10,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    // The callback route reads the response itself, so leaving the code and
    // state in the address bar afterwards would only invite a reload to
    // replay a code the provider has already spent.
    monitorSession: false,
  });

  const user = shallowRef<User | null>(null);
  manager.events.addUserLoaded((loaded: User) => {
    user.value = loaded;
  });
  manager.events.addUserUnloaded(() => {
    user.value = null;
  });
  // A reload has a stored token but no `UserLoaded` event to announce it, so
  // the first read is done here; the middleware awaits nothing for it because
  // it asks the manager directly when the ref is still empty.
  void manager.getUser().then((stored) => {
    user.value = stored;
  });

  nuxtApp.provide("oidc", manager);
  nuxtApp.provide("oidcUser", user);
});
