---
title: Edit every field a pull request's patch takes, not only the reviewers
author: Claude <noreply@anthropic.com>
created: 2026-09-16T06:25:25Z
target: dev
source: fix/hw45rswy-pr-editable-fields
reviewer: morgan.peyre@brickcode.tech
feature: web
revisions:
  - head: 6d4f8267ffa48ee0dece19e775274e74c552d0f1
    base: 2b9ac04e8a1580ad44caa6143fb7b9dabc525c0b
    date: 2026-09-16T06:25:25Z
---

Fixes #hw45rswy.

A pull request's detail page drew Labels, Assignees and Milestone as read-only text and offered no editor for the title or the description. Only `reviewers` could be changed, so retitling or relabelling a pull request meant a checkout.

Nothing about the API asked for that. `updatePr` hands straight to the same `patchEntity` that `updateIssue` uses, and `packages/server/test/server/pr.test.ts` already patches a pull request's milestone through it and expects it to land.

## What changed

**`packages/web/app/pages/prs/[ref].vue`** — `saveReviewers` becomes a general `save(change, wrote)` over `buildEntityPatch`, which already knew how to diff every field; the page had simply never handed it more than one. The sidebar gains Labels, Assignees, Features and Milestone as `LabelEditor`s, and the title and description become `EditableText`, all matching the issue page. `rank` and `deadline` stay out: they are an issue's alone (spec 02 §2.5).

Suggestions come from where the issue page gets them — a cached listing for labels and milestones, since the format keeps no registry for either, and the real registries for features and people. The listing asked for is the served checkout's rather than `allRefs`: it is a menu, and it is the same cache entry the listing page fills.

**`packages/web/app/components/EditableText.vue`** — a `disabled` prop, worded and behaving as `LabelEditor`'s already does. An unserved branch now withdraws every editor rather than only the one that was refused, because the refusal is about the branch and is the same answer for all of them.

**`packages/web/README.md`** — the paragraph that caused half the bug. It said updating a pull request is absent because the API does not expose it. That is true of `nav pr update`, which appends a revision pinning the current HEAD, and false of the patch that shares the word. The two are now named separately, so the next reader does not conclude the server needs work.

**`.navbook/specs/web/client.md`** — "read and reviewed" becomes "read, reviewed and edited", with what is editable and what is deliberately not.

## Tests

`packages/web/test-e2e/pull-requests.spec.ts` gains two: one that edits a label and a milestone and reloads to prove the write landed rather than the cache being told, and one that retitles in place. The existing unserved-branch test now asserts every editor is withdrawn, not just the reviewers one.

Both new tests were run against the pre-fix page and fail there — `edit-labels` does not exist — so they are regression tests rather than descriptions.

## What was run

Everything, in a clean install on this branch:

- `pnpm check` — lint and type-check across all four packages, clean.
- `pnpm test` — core, cli (302), server (248), web (289) and the conformance fixtures (114). No failures.
- `pnpm --filter @navbook/web test:e2e` — 129 passed, against a built bundle, a real `nav-server`, a real OIDC flow and a real git repository.
