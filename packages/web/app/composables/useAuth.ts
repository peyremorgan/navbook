/**
 * Who is signed in, and how to get a token for the next request.
 *
 * `getAccessToken` is the interesting one. Apollo asks for a token per
 * operation, and the honest answer is sometimes "not yet": the stored one has
 * expired and the refresh token has to be spent first. Concurrent operations
 * would otherwise each start their own renewal and spend each other's refresh
 * token — which the provider rotates — so a renewal in flight is shared.
 */

import type { User } from "oidc-client-ts";

/** Renew this many seconds before the token actually expires. */
const SKEW_SECONDS = 30;

export interface Auth {
  user: Readonly<Ref<User | null>>;
  /** The `email` claim, which is what the server records as `author:`. */
  email: ComputedRef<string | null>;
  name: ComputedRef<string | null>;
  signedIn: ComputedRef<boolean>;
  /** Send the browser to the provider; `returnTo` is where to come back to. */
  login(returnTo?: string): Promise<void>;
  logout(): Promise<void>;
  /** Finish the redirect back from the provider; returns where to go next. */
  completeLogin(): Promise<string>;
  /** A usable token, renewing first if the stored one is spent. */
  getAccessToken(): Promise<string | null>;
  /** Forget the stored token, so the next request has to sign in again. */
  forget(): Promise<void>;
}

function usable(user: User | null): boolean {
  if (user === null || user.access_token === "") return false;
  const expires = user.expires_at;
  if (expires === undefined) return true;
  return expires - SKEW_SECONDS > Math.floor(Date.now() / 1000);
}

export function useAuth(): Auth {
  const nuxtApp = useNuxtApp();
  const manager = nuxtApp.$oidc;
  const user = nuxtApp.$oidcUser;

  // One renewal at a time, per app instance. The refresh token is rotated on
  // use, so two renewals racing would leave one of them holding a spent one.
  const state = nuxtApp as unknown as { _navRenewal?: Promise<User | null> | null };

  const renew = async (): Promise<User | null> => {
    state._navRenewal ??= manager
      .signinSilent()
      .catch(() => null)
      .finally(() => {
        state._navRenewal = null;
      });
    return await state._navRenewal;
  };

  return {
    user,
    email: computed(() => {
      const claim = user.value?.profile?.email;
      return typeof claim === "string" ? claim : null;
    }),
    name: computed(() => {
      const claim = user.value?.profile?.name;
      return typeof claim === "string" ? claim : null;
    }),
    signedIn: computed(() => usable(user.value)),

    async login(returnTo?: string) {
      // Read from the browser rather than `useRoute()`: this is called from the
      // Apollo error link as well as from a component, and outside a setup
      // context there is no route to inject.
      const here = `${window.location.pathname}${window.location.search}`;
      // The provider hands `state` back untouched, which is how the callback
      // route knows where the person was going before it interrupted them.
      await manager.signinRedirect({ state: returnTo ?? here });
    },

    async logout() {
      // `removeUser` rather than `signoutRedirect`: ending the session at the
      // provider is the provider's business, and one without an end-session
      // endpoint would refuse anyway.
      await manager.removeUser();
      // Somewhere the route guard will not immediately bounce back out of.
      // Every other page needs a token, so navigating to one of those would
      // send the person straight back to the provider — which, against a
      // provider holding a session cookie, signs them back in at once.
      await navigateTo("/signed-out");
    },

    async completeLogin() {
      const signedIn = await manager.signinCallback();
      const target = signedIn?.state;
      return typeof target === "string" && target.startsWith("/") ? target : "/";
    },

    async getAccessToken() {
      const current = user.value ?? (await manager.getUser());
      if (usable(current)) return current?.access_token ?? null;
      // Nothing stored, or something stored with no refresh token to spend:
      // there is nothing to renew *from*. Saying so at once matters, because
      // `signinSilent` would otherwise fall back to a hidden iframe — a flow
      // that needs third-party cookies, cannot get them, and blocks for its
      // whole timeout before admitting it. The caller signs in properly.
      if (current?.refresh_token === undefined) return null;
      const renewed = await renew();
      return usable(renewed) ? (renewed?.access_token ?? null) : null;
    },

    async forget() {
      await manager.removeUser();
    },
  };
}
