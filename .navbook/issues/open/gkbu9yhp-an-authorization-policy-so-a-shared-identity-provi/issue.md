---
title: An authorization policy, so a shared identity provider does not open the repository to all its users
author: Morgan PEYRE <morgan@peyre.info>
created: 2026-09-15T08:35:43Z
labels: [enhancement]
feature: [server, gateway, web]
parent: tn7ptt6k
---

`nav-server` authorizes every token its issuer signs for its audience, for reads and writes alike, and the READMEs say to "put the policy you need in front". In practice there is nothing to put in front: the API takes a bearer token, so a forward-auth proxy would have to verify the same JWT and reimplement the check, and an identity provider rarely scopes a client to a subset of its users.

That leaves a deployment against a shared provider open to everybody the provider knows. Brickcode's is shared: it signs in the employees of every client business, and self-registration is currently enabled in its code. Pointed at it, the Factory tracker would be readable, and writable under the committer's credentials, by anyone who registers an account.

## What it should do

An authorization policy the server applies after verifying the token, from options with a flag and a variable each, all optional, all combined with AND:

- `--require-claim <name>=<value>` (repeatable; `NAV_SERVER_REQUIRE_CLAIMS`, comma-separated): the claim equals the value, or contains it when the claim is an array or a space-separated string. `scope` and Better Auth's `roles` are both space-separated strings, so `roles=navbook::member` works against either shape.
- `--allow-email-domain <domain>` (repeatable; `NAV_SERVER_ALLOW_EMAIL_DOMAINS`): the `email` claim's domain is one of these.
- `--require-email-verified` (`NAV_SERVER_REQUIRE_EMAIL_VERIFIED=true`): refuse a token whose `email_verified` is not `true`. Without it, a provider that lets somebody set an unverified address lets them author as that person, which the server README already warns about.

A token that verifies but fails the policy is refused with a new `FORBIDDEN` code, not `UNAUTHENTICATED`: the person is signed in, and sending them back to the provider would loop. The web client shows a page that says the account is not allowed on this repository and offers to sign out, instead of redirecting. `compose.yaml` and `.env.example` carry the three keys, empty by default.

## Edges

- The policy applies to every operation, `viewer` included, so a refused person learns nothing about the repository; the refusal names which rule failed only in the server log, like the other authentication failures.
- `doctor` walks the whole tree under the server's single lock (about two minutes with `nav doctor` 0.2.0 on a 1,260-file tree). With the policy in place only members can call it; whether it belongs in the API at all is a separate question worth a sentence in the PR.
- Starting with no policy logs one warning line saying every token the issuer signs may write, so an open deployment is a visible choice.
