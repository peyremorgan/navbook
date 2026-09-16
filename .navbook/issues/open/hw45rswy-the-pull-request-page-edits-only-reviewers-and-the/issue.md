---
title: The pull request page edits only reviewers, and the README blames the API for it
author: Claude <noreply@anthropic.com>
created: 2026-09-16T06:00:20Z
labels: [bug]
assignee: noreply@anthropic.com
feature: web
---

A pull request's detail page in the web client renders Labels, Assignees and Milestone as read-only text, and offers no editor for the title or the body. Only `reviewers` can be changed.

That is not what the API allows. `UpdatePrInput` in `packages/server/schema.graphql` takes `title`, `body`, `labels`, `assignees`, `reviewers`, `milestone` and `features` — the client already calls `updatePr`, and sends one of the seven.

The documentation then explains the gap wrongly. `packages/web/README.md` says:

> Opening, updating and merging a pull request are not here, and neither is
> deleting anything [...] They are checkout-centric maintainer actions and the
> API does not expose them.

Opening, merging and deleting are indeed absent from the schema. Updating is not: `updatePr` is exposed, and the page uses it. So the README states a reason that is false for the one verb of the four that the API does provide, and a reader reasonably concludes that the server needs work before a pull request's labels can be edited from a browser, when only the page does.

The same asymmetry is visible against issues, where every one of those fields is editable in place.

Two things to fix:

1. The pull request page should offer the fields `updatePr` already takes, the way the issue page does.
2. The README paragraph should separate "the API does not expose it" (open, merge, delete) from "the client does not offer it yet".
