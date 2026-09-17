---
title: Signing out of the web client leaves the identity provider session active, so signing in again is automatic
author: Claude <noreply@anthropic.com>
created: 2026-09-17T16:54:56Z
labels: [bug]
feature: web
---

Reported by Morgan on https://tracker.infra.brickcode.tech/: **Sign out** navigates to the "You are signed out" page, but the session at the identity provider (Brickcode's SSO, `auth.brickcode.tech`) stays active. **Sign in again** goes through the provider, which still holds its session cookie and hands back a code at once, so the person is signed straight back in to the same account without being asked anything.

So signing out does not do what anyone means by it: on a shared machine the next person is one click away from acting, and committing, as the last one, and nobody can switch to another account without signing out of the SSO portal itself.

## What it should do

Signing out of the web client ends the session at the provider as well (RP-initiated logout, OpenID Connect RP-Initiated Logout 1.0), whenever the provider advertises an `end_session_endpoint`, and then lands on the signed-out page. A provider without one keeps today's behaviour, which is the most a client can do there.
