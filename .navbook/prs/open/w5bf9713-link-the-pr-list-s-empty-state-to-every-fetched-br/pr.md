---
title: Link the PR list's empty state to every fetched branch
author: Claude <noreply@anthropic.com>
created: 2026-10-01T00:55:02Z
target: dev
source: fix/h8jxhiz6-empty-state-all-refs-link
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: f3ba09d7a98623fb78f3f440ed944104cadd54c4
    base: 9097617bd4d24690684bab67cc0d8c7d717f6546
    date: 2026-10-01T00:55:02Z
---

Fixes #h8jxhiz6.

On `/prs`, with the **Every fetched branch** switch off, an empty listing said
"try every fetched branch" as plain text. That sentence is now a link to the
same filter with `refs=all` added, so clicking it turns the switch on and
reruns the search across every fetched branch. The rest of the filter is kept.

## Changes

- `QueryState` wraps its empty description in an `empty-description` slot that
  defaults to the `emptyDescription` prop. Every other view is unchanged.
- `pages/prs/index.vue` fills that slot. With the switch off, the suggestion is
  a `NuxtLink` to the current query plus `refs=all`, with `replace` so it
  behaves like the switch in history. With the switch on, the text is the same
  as before and has no link.
- A new e2e case in `pull-requests.spec.ts` opens `/prs?q=bbbb0002`, which
  only a fetched branch can satisfy, clicks the link, and checks the address
  bar, the switch and the row.

## Testing

- The new e2e case fails on `dev`: no link named "try every fetched branch".
  It passes with the fix.
- `pull-requests`, `filter-memory` and `inbox` e2e specs: 57 passed.
- Full web e2e suite: 173 passed.
- Web unit suite (vitest): 426 passed. `nuxi typecheck` and `biome check`
  are clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
