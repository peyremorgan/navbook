---
title: Name the OIDC provider by its discovery document
author: Claude <noreply@anthropic.com>
created: 2026-09-16T17:17:13Z
target: dev
source: fix/hc9g6iog-oidc-discovery-url
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: a88de967e1c7461b15fa1bcc285833a5f60443c8
    base: 2e69bc5c1b615c81754a5c2a49d22d77079d6232
    date: 2026-09-16T17:17:13Z
  - head: 122167a5abe9f0d4d1d31d53e5b7b28db9d10d1b
    base: 90e8ff208af16918f3cec7a2a548e5e9b7af9982
    date: 2026-09-16T17:38:42Z
merged:
  date: 2026-09-16T17:39:43Z
  by: Claude <noreply@anthropic.com>
  commit: 4923f93da7e0dc24670cdf2b3057f98b3d75b046
---

Fixes #hc9g6iog: the web client could not start a sign-in against a provider whose discovery document is not under its issuer, and the server, told the same issuer, hit the same 404 unless the JWKS URL was spelled out.

The provider is now named by its discovery document, once, on both sides:

- **Web client.** `oidc.discoveryUrl` replaces `oidc.issuer` in `config.json`. It is passed to oidc-client-ts as both `authority` and `metadataUrl`, so the library fetches the document from where it actually is. The client never validated a token's `iss` (oidc-client-ts checks `sub`, `nonce`, `auth_time` and `azp`), so nothing is lost by not telling it the issuer, and there is no boot-time fetch: `authority` is only the session-storage key and the value a sign-in state is checked against.
- **Server.** `--oidc-discovery-url` / `NAV_SERVER_OIDC_DISCOVERY_URL` is the required option; `discoverProvider` reads both `issuer` and `jwks_uri` from the document, and `jwtVerify` checks `iss` against what it declared. Trusting the document's `issuer` gives it nothing it did not have: it already named the keys. `--oidc-issuer` and `--oidc-jwks-url` remain as a pair for a provider the server cannot reach at start; half of that pair, or either half beside a discovery URL, is refused with a message naming the other shape.
- **Compose.** One `NAVBOOK_OIDC_DISCOVERY_URL` feeds both containers. `NAVBOOK_OIDC_ISSUER` and `NAVBOOK_OIDC_JWKS_URL` are gone from `.env.example` and `compose.yaml`; an existing `.env` needs the one new key. Nothing is published yet, so no deployed image reads the old one.

Tests: the server's stub issuer can put its issuer under a path with the document at the host root, and `auth.test.ts` proves discovery by URL accepts its tokens where discovery by issuer could not have found the document, and still refuses a token from another issuer. `config.test.ts` covers both shapes and the refusals. The deploy tests and the CI smoke steps follow the renamed key; the API smoke keeps the spelled-out pair since its issuer host is unreachable.

Verified in a worktree: server suite 261/261, deploy tests 59/59, web unit suite 289/289, `tsc`, `nuxi typecheck` and `biome check` clean. The end-to-end suite was not run here (no room for a browser on this machine); its stack helper now passes the discovery URL to both the server and the bundle.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
