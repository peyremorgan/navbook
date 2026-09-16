---
title: "fix(web): ask for the API as a resource on every token request"
author: Claude <noreply@anthropic.com>
created: 2026-09-16T17:06:22Z
target: dev
source: fix/i6nzbn1d-api-resource-indicator
reviewer: morgan.peyre@brickcode.tech
feature: [web, gateway]
revisions:
  - head: 2b176cbc8e024a48ff01a1f3840020c70b53f57d
    base: 71e01439e02c5d61a54414d3b912ce03dc328467
    date: 2026-09-16T17:06:22Z
merged:
  date: 2026-09-16T17:12:17Z
  by: Claude <noreply@anthropic.com>
  commit: e17b8bcfd88da4e9a6097153bb82282bd55481d0
---

Fixes #i6nzbn1d. Against a provider that implements resource indicators (RFC 8707), and Better Auth in particular, the web client signed in and was then refused on every operation. The provider minted an opaque access token because no token request carried `resource`, and `nav-server` can only verify a JWT.

## What changes

- **`packages/web/app/utils/oidc.ts`** (new): the `UserManager` settings, moved out of the plugin so they can be tested. The audience now goes out as `audience` (Auth0) **and** `resource`: `settings.resource` covers the authorization URL, and `extraTokenParams: { resource }` covers the code exchange.
- **`ApiUserManager`**: a `UserManager` whose `signinSilent` defaults `resource`. This matters more than the issue text suggests. oidc-client-ts 3.5.0 takes neither `resource` nor `extraTokenParams` from settings on a **refresh**. It uses only the arguments `signinSilent` receives, and both callers pass none: `useAuth().renew()` and the library's own `SilentRenewService`. A settings-only fix would have worked until the first renewal, about an hour, and then swapped the JWT for an opaque token again. The repro is in the issue comment.
- **Dev issuer**: reads `resource` on `/authorize` (ahead of `audience`) and on the token request for both grants, which is where Better Auth reads it. Without one it keeps the sign-in's audience, so development still works for an Auth0-style client.
- **Server tests**: a token whose `aud` is an array that includes the API's audience is accepted, and one that leaves it out is refused. Better Auth adds its userinfo URL to `aud` whenever `openid` is requested. `SignOptions.audience` now accepts `string | string[]`.
- **Docs**: the web README's identity-provider section and `.env.example` now say the configured audience must be one of the provider's valid audiences (`validAudiences` in Better Auth), or it answers `invalid_request`.

## Tests

- `test/nuxt/oidc.test.ts` drives oidc-client-ts against a stub token endpoint and asserts what the provider receives on the authorization URL, the code exchange and a bare `signinSilent()` refresh. With the override removed, the refresh test fails (`null` instead of the audience).
- `test/node/dev-issuer.test.ts`: `resource` on authorize, on the code exchange and on a refresh sets `aud`.
- Run in the worktree: web vitest 20 files, 293 tests; `nuxi typecheck`; `tsc -p tsconfig.tools.json`; server `tsc --noEmit`; server suite 259 pass, 0 fail; biome on the touched files.
- **Not run**: the Playwright e2e suite. `/tmp` had no room for a browser and a build. It still signs in through the dev issuer, which now receives `resource` as well.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
