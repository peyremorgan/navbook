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
  - head: 145e7e5939d43af26b589266f1e91637d3d011de
    base: 5a7718e8e09e5677bb4bbd5d8357056dd6e7dc4a
    date: 2026-09-27T17:30:00Z
---

Fixes #x8otoby0: nothing in the web client asked before a navigation threw away typed, unsaved work.

## What changes

- **One registry of drafts** (`app/utils/unsaved.ts`, `useUnsavedWork`). Each owner holds an "is this dirty?" predicate while mounted, read at the moment of leaving:
  - `SpecEditor` (now in `@navbook/plugin-kb`'s layer): editing, and title or body differ from the file
  - `EditableText`: editing, and the draft differs from the value
  - `CommentForm` and `ReviewForm`: a non-empty body
  - `issues/new.vue`: any field typed. The pre-filled parent, and each plugin field's first value in `extra` (e.g. a `?feature=`), count only if changed. Nothing counts once the issue is filed.
  - The knowledge base's "Add a document" and "New feature" dialogs, while open and not empty
  - A refused edit kept on the issue, PR or feature page (`usePendingEdits().refused`, `useStaleEdit().stale`)
- **In-app navigations** (`app/middleware/00.unsaved.global.ts`): when the **path** changes and something is dirty, an in-app `LeaveDialog` asks "Keep editing" or "Discard and leave". Escape and a click on the overlay both mean stay. It is a middleware named to sort before `auth.global`, so the question comes before any token renewal or provider redirect for that navigation.
- **Ways out of the document** (`app/plugins/04.unsaved.ts`): `beforeunload` covers reloads and closed tabs.
- **The app's own ways out ask for themselves**, in the dialog, before anything irreversible, then `agree()` (a one-shot pass for the next guard, so there is no second prompt):
  - Signing out (`useAuth().logout`) asks before the token is dropped.
  - An UNAUTHENTICATED response (`plugins/03.apollo.ts`) asks before the token is forgotten and the browser sent to the provider. "Stay" keeps the page, draft and token, and a toast says the write failed and to copy the text out.
  - A FORBIDDEN response goes to `/not-allowed` through the same guard.
  - After "stay", neither refusal asks again until a navigation lands.

## Choices worth a look

- **Global, not per-page `onBeforeRouteLeave`.** `/issues/a` → `/issues/b` is an *update* on the same route record, so leave guards don't run. Yet `NuxtPage` mounts a fresh instance keyed by path, so the draft is lost anyway.
- **Query-only changes are never asked about.** A PR's `?tab=` and a listing's filters keep the page mounted.
- **An edit that is still being saved is not held.** If it is refused after the page is left, `usePendingEdits`'s `lost` toast already says so.
- **Interplay with the provider sign-out (#icroff4l, now on dev).** The question comes first, then `agree()`, then the end-session redirect, whose `beforeunload` spends the agreement and does not prompt. While `logout` runs, an UNAUTHENTICATED answer from an operation still in flight is ignored (`useAuth().signingOut()`), as `login` already was, so the dialog cannot pop up mid sign-out.

## Tests

- **Playwright**, rebased onto the plugin system:
  - `packages/web/test-e2e/unsaved-work.spec.ts`, 10 cases on host editors;
  - `packages/plugin-kb/test-e2e/unsaved-work.spec.ts`, 4 cases on the document editor and the add-document dialog, since a host bundle without the layer has no `/features`.
  - Before the rebase, the first version's 9 cases failed 7 against dev, and the self-review's 4 new cases (UNAUTHENTICATED asked in-app and once, FORBIDDEN once, a refused edit, the add-document dialog) failed 4 against the first version.
- **Unit tests** `test/nuxt/unsaved.test.ts`, 7 cases, for the registry.
- **Checks** (with `NAVBOOK_WEB_PLUGINS=@navbook/plugin-kb`, as CI): web `vitest` 410/410, plugin-kb `node --test` 138/138, `nuxi typecheck`, `tsc` and `biome check` clean. Full e2e suite: see the latest review.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
