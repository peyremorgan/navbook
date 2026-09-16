---
title: Ask for the API as a resource, or providers that implement RFC 8707 hand out opaque tokens
author: Morgan PEYRE <morgan@peyre.info>
created: 2026-09-15T08:35:42Z
labels: [enhancement]
feature: [web, gateway]
parent: rmsuy3z6
---

The web client asks for the API's audience with an `audience` query parameter on the authorization request (`packages/web/app/plugins/02.auth.ts`, `extraQueryParams: { audience }`). That is Auth0's spelling. Providers that implement resource indicators (RFC 8707) read `resource` instead, and read it at the **token** endpoint.

Better Auth's `@better-auth/oauth-provider` (1.5.6, the one Brickcode's identity provider runs) is one of them, and it goes further: it mints a JWT access token only when the token request carries `resource`, and an opaque one otherwise (`createUserTokens` → `checkResource(ctx)` reads `ctx.body.resource`; `isJwtAccessToken = audience && !disableJwtPlugin`). Against that provider the client signs in fine, then every GraphQL operation is refused with `UNAUTHENTICATED`, because `nav-server` verifies a JWT and was handed an opaque string. Nothing on screen says why.

## What it should do

Send the configured audience as `resource` as well as `audience`: on the authorization request, on the code exchange, and on every refresh (oidc-client-ts takes `resource` in the `UserManager` settings and `extraTokenParams` for the token requests). A provider that knows neither ignores both, so no configuration key is added.

## Edges

- Better Auth validates `resource` against its `validAudiences` and answers `invalid_request` for anything else, so the value the deployment configures has to be a string the provider lists. The README's identity-provider section should say so.
- With the `openid` scope, Better Auth appends its userinfo URL to `aud`, so the token's audience is an array of two. `jose`'s `audience` check accepts a token whose array contains the expected value; a server test with an array `aud` pins it.
- The development issuer (`packages/web/script/dev-issuer.ts`) should honour `resource` the way it honours `audience`, so the end-to-end suite exercises the spelling a real provider uses.
