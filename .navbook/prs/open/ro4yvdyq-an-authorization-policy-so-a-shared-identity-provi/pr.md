---
title: An authorization policy, so a shared identity provider does not open the repository to all its users
author: Claude <noreply@anthropic.com>
created: 2026-09-16T17:55:30Z
target: dev
source: fix/gkbu9yhp-authorization-policy
reviewer: morgan.peyre@brickcode.tech
feature: [server, web, gateway]
revisions:
  - head: 90c02977088cb5feccff1aa3a557cb3f2312d13a
    base: 4c668c5db32cdc826b2c0d89667787d20bfb3eac
    date: 2026-09-16T17:55:30Z
  - head: 1cc9dd977c22444c4ceb59bfa374d1bd68023914
    base: 49ac11fa10f1994857e328358132bb0e272aaa0b
    date: 2026-09-17T11:38:30Z
---

Fixes #gkbu9yhp: `nav-server` admitted every token its provider signed for the audience, so a deployment against a shared provider was open to everybody that provider knows, and there was nothing to "put in front" that would not have to verify the same JWT again.

The server now applies an authorization policy after the token verifies and before any operation runs — `viewer` and introspection included — from three optional settings, each with a flag and a variable, all ANDed:

- **`--require-claim <name>=<value>`** (`NAV_SERVER_REQUIRE_CLAIMS`, comma-separated), repeatable. The claim equals the value, or carries it when the claim is an array or a space-separated string, so `roles=d3952bfb::developer` works against an array (Brickcode's provider), a Better Auth string, or `scope`. A member that merely contains the value (`d3952bfb::developers`) does not match, and a value with a space in it (`groups=Site Admins`) is only ever compared whole, never as two words of a longer string.
- **`--allow-email-domain <domain>`** (`NAV_SERVER_ALLOW_EMAIL_DOMAINS`), repeatable. The domain of the address the identity was built from — the `email` claim, trimmed, the same string `author:` gets — lower-cased, is one of these; subdomains are not.
- **`--require-email-verified`** (`NAV_SERVER_REQUIRE_EMAIL_VERIFIED=true`): `email_verified` must be exactly `true`.

A verified token the policy refuses is answered with a new `FORBIDDEN` code and a 403, not `UNAUTHENTICATED`: the person is signed in, and a client that sent them back to the provider would loop. The message says only that the account is not allowed on this repository; which rule refused whom (`refused "a@b": the token's 'roles' claim does not carry …`) goes to the server's log, with every token-supplied value JSON-quoted so an address somebody chose cannot end the line and forge another. A bad claim or domain spelling is a `ConfigError` at start; a repeatable flag given empty (`--require-claim "$UNSET"`) is treated as not given, so it cannot silently shadow the variable's list and open the server. Starting with no policy logs `warning: no authorization policy; every token the provider signs for '<aud>' may read and write`, so an open deployment is a visible choice.

Two small things beside the policy. The environment booleans now share one reader: `NAV_SERVER_REQUIRE_EMAIL_VERIFIED` and `NAV_SERVER_GRAPHIQL` both take `true`/`yes`/`1` and `false`/`no`/`0` in any case, an empty value is unset, and anything else is refused at start — which is a change for `NAV_SERVER_GRAPHIQL`, previously "anything but `false` is on". And a value with a comma in it cannot be given through a variable, which the README says; the flag takes it.

`compose.yaml` and `.env.example` carry `NAVBOOK_REQUIRE_CLAIMS`, `NAVBOOK_ALLOW_EMAIL_DOMAINS` and `NAVBOOK_REQUIRE_EMAIL_VERIFIED`, empty by default; the deployment this was filed for sets the first to `roles=d3952bfb::developer`.

**Web client.** The Apollo error link treats `FORBIDDEN` apart from `UNAUTHENTICATED`: instead of forgetting the token and signing in again, `useAuth().refused()` replaces the route with `/not-allowed`, a page — exempt from the guard like `/signed-out`, the three token-less routes now named once in `utils/navigation.ts` — that names the signed-in address, says the server does not admit it, and offers "Try again" (for access granted while they sat there; the token is still good) and "Sign out". Reached without a session, from Back or a bookmark, it offers "Sign in" instead. A refused write still gets its toast, since the person has just lost what they typed. `signed-out.vue` and the new page share an `AuthNotice` component. Signing out ends only this app's session, as before; against a provider still holding its own, "sign in as somebody else" is as far as that provider lets you, which the page's comment says.

**Development issuer.** Its form takes a space-separated list of roles, minted as a `roles` array in the access token, and a ticked-by-default "address is verified" box minted as `email_verified`, so a `dev:stack` API started with `NAV_SERVER_REQUIRE_CLAIMS=roles=navbook::member` or `--require-email-verified` can be tried from the browser on both sides of each rule, refusal page included.

On the issue's open question about `doctor`: it is still exposed, and with a policy only admitted accounts can call it; whether it belongs in the API at all is left as it was, since the policy answers the concern that raised it. The claim name and shape for Better Auth (`roles`, space-separated) are as the issue states them; I could not check that offline, and the test that names it is easy to retitle if the provider spells it otherwise.

Tests: `policy.test.ts` covers each rule against the claim shapes, the whole-value rule for spaced values, trimming and the quoted reason; `config.test.ts` the flags, the variables, flag-over-variable, the empty flag, the boolean spellings and the refusals; `authorization.test.ts` starts real servers with a role policy and a policy of all three rules, and proves admission, the 403 with an uninformative message, the guard on mutations, that `UNAUTHENTICATED` still comes first for a bad token, and the quoted log line; the no-policy warning is asserted in `auth.test.ts`, whose server already runs without one. The web suite pins the heading and the `isForbidden`/`isUnauthenticated` distinction; the dev-issuer suite the roles and `email_verified` claims both ways.

Verified in a worktree on top of #kpz5ow8j: server suite, deploy tests, web unit suite, `tsc`, `nuxi typecheck` and `biome check` clean: 326 server tests, 59 deploy tests, 310 web tests. The end-to-end suite was not run here (no room for a browser on this machine), so the refusal page has no browser test yet; the e2e stack helper takes no policy option, which is the natural place to add one.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
