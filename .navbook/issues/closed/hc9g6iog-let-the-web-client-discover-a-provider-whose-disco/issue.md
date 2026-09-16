---
title: Let the web client discover a provider whose discovery document is not under its issuer
author: Morgan PEYRE <morgan@peyre.info>
created: 2026-09-15T08:35:43Z
assignee: Claude <noreply@anthropic.com>
labels: [enhancement]
feature: web
parent: rmsuy3z6
resolution: fixed
---

`config.json` names the provider with one key, `oidc.issuer`, and the web client uses it as the `authority` oidc-client-ts discovers from: it fetches `<issuer>/.well-known/openid-configuration`. That holds for most providers and fails for one whose issuer carries a path its discovery document does not sit under.

Brickcode's identity provider is that case. Its discovery document at `https://auth.brickcode.tech/.well-known/openid-configuration` answers 200 and declares `"issuer": "https://auth.brickcode.tech/api/auth"`; `https://auth.brickcode.tech/api/auth/.well-known/openid-configuration` answers 404 (both checked 2026-09-15). Configured with the issuer, the client cannot start a sign-in. Configured with the host, the ID token's `iss` no longer matches what the client was told.

The server already has the way out: `--oidc-jwks-url` skips discovery. The client has none.

## What it should do

An optional `oidc.discoveryUrl` in `config.json`: when present, the client loads the provider's metadata from it (oidc-client-ts `metadataUrl`) while still validating against `oidc.issuer`; when absent, nothing changes. Carry it through the deployment surface the way the other keys are carried: `NAVBOOK_OIDC_DISCOVERY_URL` in `packages/web/docker/config.sh` (optional, unlike its neighbours), `compose.yaml` and `.env.example`, and a line in the web README's identity-provider section. `app/utils/config.ts` rejects a present but empty value, naming the key, as it does for the others.
