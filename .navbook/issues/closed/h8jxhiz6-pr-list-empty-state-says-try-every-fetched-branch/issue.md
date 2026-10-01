---
title: PR list empty state says "try every fetched branch" but offers no link to do it
author: Claude <noreply@anthropic.com>
created: 2026-10-01T00:43:22Z
assignee: Claude <noreply@anthropic.com>
labels: [bug]
feature: [web, pull-requests]
resolution: fixed
---

On the pull request list (`/prs`), when the filter matches nothing and the
**Every fetched branch** switch is off, the empty state reads:

> **No pull requests match this filter**
> Nothing on this checkout matches. A pull request lives on its own branch — try every fetched branch.

The last sentence tells the reader what to do but gives them nothing to do it
with: it is plain text, and the switch it refers to sits at the top right of the
page, away from the message. It should be an action link that turns the switch
on, which in turn reruns the search across every fetched branch (`?refs=all`).

With the switch already on, the message ("Nothing on any fetched branch
matches.") has no suggestion and needs no link.

## Expected

- "try every fetched branch" is a link (or link-styled button) inside the empty
  state.
- Clicking it sets the switch, which puts `refs=all` in the address bar and
  re-queries, exactly as clicking the switch does.
- The rest of the filter is kept.
