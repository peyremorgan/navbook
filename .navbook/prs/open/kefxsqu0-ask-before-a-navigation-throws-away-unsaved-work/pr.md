---
title: Ask before a navigation throws away unsaved work
author: Claude <noreply@anthropic.com>
created: 2026-09-27T12:58:31Z
target: dev
source: fix/x8otoby0-unsaved-guard
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
feature: web
revisions:
  - head: 7cf104a8fa0f209df96c39f2093f381ea9798e0e
    base: 7e18cf64b1d246d2fceace05d209c007a94bcc5e
    date: 2026-09-27T12:58:31Z
---

Fixes #x8otoby0: nothing in the web client asked before a navigation threw away typed, unsaved work.

## What changes

- **One registry of drafts** (`app/utils/unsaved.ts`, `useUnsavedWork`). Each owner holds an "is this dirty?" predicate while mounted, read at the moment of leaving:
  - `SpecEditor`: editing, and title or body differ from the file
  - `EditableText`: editing, and the draft differs from the value
  - `CommentForm` and `ReviewForm`: a non-empty body
  - `issues/new.vue`: any field typed. The pre-filled feature and parent count only if changed, and nothing counts once the issue is filed.
- **Two guards** (`app/plugins/04.unsaved.ts`):
  - `router.beforeEach` asks in an in-app `LeaveDialog` ("Keep editing" / "Discard and leave") when the **path** changes and something is dirty. Escape and a click on the overlay both mean stay.
  - `beforeunload` covers reloads, closed tabs, and the redirect to the provider when a save comes back UNAUTHENTICATED.
- **Sign-out asks first** (`useAuth().logout`), before the token is dropped, so "Keep editing" keeps the session too. It then lets go of the drafts, so the navigation afterwards doesn't ask a second time.

## Choices worth a look

- **Global, not per-page `onBeforeRouteLeave`.** `/issues/a` → `/issues/b` is an *update* on the same route record, so leave guards don't run. Yet `NuxtPage` mounts a fresh instance keyed by path, so the draft is lost anyway.
- **Query-only changes are never asked about.** A PR's `?tab=` and a listing's filters keep the page mounted, and the PR page deliberately keeps tabs alive so drafts survive.
- **Not covered:** an `EditableText` save that is in flight or refused. The editor closes on save by design, and `usePendingEdits` owns that state and shows the refusal.
- **Overlap with PR `njfzket6` (#icroff4l).** Both edit `useAuth().logout`. They combine cleanly: the question comes first, then the provider sign-out redirect, which no longer prompts because the drafts have been let go.

## Tests

- **New Playwright spec** `test-e2e/unsaved-work.spec.ts`, 10 cases. Against the unfixed bundle, 7 of them failed (quoted on the issue). They cover:
  - the sidebar, a reference followed from the preview, and Back between two issues;
  - a PR's tabs, which stay free;
  - reload, the UNAUTHENTICATED redirect, and sign-out, both staying and leaving;
  - nothing is asked for an untouched editor or after filing an issue.
- **Unit tests** `test/nuxt/unsaved.test.ts`, 7 cases, for the registry.
- **Full web e2e suite:** 163/163. After a last `ReviewForm` tweak, the `unsaved-work`, `pull-requests` and `auth` specs were rerun (42/42).
- **Web checks:** `vitest` 384/384, `nuxi typecheck` clean, `biome check` clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
