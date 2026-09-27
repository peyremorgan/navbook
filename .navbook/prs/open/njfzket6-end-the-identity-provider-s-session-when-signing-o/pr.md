---
title: End the identity provider's session when signing out of the web client
author: Claude <noreply@anthropic.com>
created: 2026-09-17T17:01:14Z
target: dev
source: fix/icroff4l-provider-sign-out
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
feature: web
revisions:
  - head: 4550707e52bd0fdd1c0b34b4d890857525557185
    base: b01f9b0d9d244a4804a1074c9c0ffe94dc9fae34
    date: 2026-09-17T17:01:14Z
  - head: 082fbc5741f3543197f2ecdbc0b437bf82338e83
    base: 7e18cf64b1d246d2fceace05d209c007a94bcc5e
    date: 2026-09-27T13:03:52Z
---

Fixes #icroff4l: **Sign out** on the web client only removed the stored token, so the identity provider's session cookie stayed. **Sign in again** then came straight back as the same account without asking.

## What changes

- **`useAuth().logout`** asks the provider to end its session whenever discovery names an `end_session_endpoint` (`ApiUserManager.endsSessions`). It does this through `signoutRedirect`, which removes the stored token first, sends the stored id token as `id_token_hint`, and navigates to the provider. A provider without the endpoint, or a discovery document that can't be read, keeps the previous behaviour: remove the token and go to `/signed-out`.
- **`post_logout_redirect_uri`** is now `<origin>/signed-out` (it was `<origin>` and was never used). The provider returns the browser to the page that asks before signing in again.
- **`ApiUserManager.signoutRedirect`** clears `extraQueryParams` for the end-session request, so `audience` isn't added there. This mirrors the `signinSilent` override.
- **`$oidc`** is typed as `ApiUserManager`.
- **Dev issuer**: new `GET /end-session` endpoint, listed in discovery. It checks the client from `client_id` or the hint's `aud`, then redirects back with `state`. The e2e "stays signed out after signing out" test now checks that the browser went through it with an `id_token_hint`.
- **Docs**: the web README ("What the identity provider has to do") and `.env.example` say what the provider needs registered.

## ⚠️ Deployment prerequisite (auth.brickcode.tech)

Better Auth (`@better-auth/oauth-provider`, read from 1.7.5's `rpInitiatedLogoutEndpoint`) needs two settings on OAuth client `T1y-iamUXb2zretUpY1bN2TCJHu1fATi`. **Without the first, deploying this makes Sign out stop on a Better Auth error page** instead of going back to the tracker. The local token is still gone, but that's worse than today.

1. `enableEndSession: true` (`enable_end_session`). Otherwise the answer is `invalid_client`, "The client is not allowed to initiate logout".
2. `https://tracker.infra.brickcode.tech/signed-out` in `postLogoutRedirectUris`. Otherwise the session ends but the browser stays on Better Auth's "logged out" page.

With both set and a valid `id_token_hint` for the current session, Better Auth deletes the session, clears its cookie and redirects without asking for confirmation.

## Verified

- `vitest run` in `packages/web`: 384 tests after the rebase and self-review (originally 315, 5 of them new) (plus one new assertion in the existing discovery test), all pass. New tests:
  - `test/nuxt/oidc.test.ts`: `endsSessions` with and without the endpoint, and with an unreadable document. `signoutRedirect` goes to the end-session endpoint with `id_token_hint` and `post_logout_redirect_uri=<app>/signed-out`, without `audience`, and with the user removed.
  - `test/node/dev-issuer.test.ts`: the end-session redirect, the page shown with no redirect, and refusals.
  - A mutation check (reverting the redirect URI and the `extraQueryParams` override) makes the new `oidc` test fail.
- `nuxi typecheck`, `tsc -p tsconfig.tools.json --noEmit` and `biome check` are clean.
- **Playwright e2e** (rebased onto `dev` at 7e18cf6): 154/154 pass. "stays signed out after signing out" fails against `dev`'s old `logout` (no request to `/end-session`). After deploying, check manually on the tracker that Sign out → Sign in again shows the Better Auth login form.

## Self-review fixes (3f51cc0)

- **Race with a refused operation:** an operation answered UNAUTHENTICATED while signing out made the Apollo error link call `login()`. That redirect to `/authorize` could overtake the one to `/end-session` and leave the provider's session alive. `login()` now does nothing while a sign-out is under way. New e2e test "is not signed back in by a refusal that lands while signing out" holds the end-session navigation, releases a refused query, and asserts no `/authorize` request. It fails with the guard removed.
- **Back-forward cache:** `signoutRedirect` settles only when the page is restored without having left. `logout` returned early and left a guarded page with no token; it now lands on `/signed-out`.
- **`client_id` alongside `id_token_hint`:** oidc-client-ts leaves it out when there is a hint. Better Auth's confirmation fallback (a hint it cannot verify) keeps the redirect back only for a request that names its client. It is added exactly once; unit tests cover both with and without an id token.
- **Dev issuer:** refuses a `client_id` the hint was not issued to, and a malformed `post_logout_redirect_uri` (400, not 500); accepts a hint whose `aud` is a list.
- Also: e2e asserts `/signed-out` comes back with no `state` in the address and no `oidc.*` record in storage (oidc-client-ts 3.5.0 sends no `state` without state data).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
