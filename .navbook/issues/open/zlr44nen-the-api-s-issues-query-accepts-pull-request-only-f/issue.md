---
title: The API's issues query accepts pull-request-only filters, so review:pending matches every issue
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-20T12:35:22Z
labels: [bug]
feature: [server, format]
---

`EntityFilter` carries three terms that describe something only a pull request has — `reviewers`, `reviews`, `awaiting` — and one that describes something only an issue has, `deadline`. The `prs` resolver rejects `deadline`. The `issues` resolver rejects nothing.

`reviews` is the damaging one. `reviewSummary` on an issue finds no revisions and no reviewers, so `decide([])` returns `pending` and the filter matches, which means `issues(filter: { reviews: [PENDING] })` returns **every issue in the repository**, presented as the answer to a question about reviews.

`awaiting` and `reviewers` match nothing, which is the failure spec 04 names. `reviewers` is in fact worse than nothing: `reviewer:` is not an issue-only key that `validateIssue` rejects, so an issue carrying one by hand — unknown keys are preserved by §2.4 — is matched. The answer to a pull-request filter therefore depends on whether somebody once hand-edited a key into an issue file.

## Repro

```graphql
query { issues(filter: { reviews: [PENDING] }) { id title } }
```

returns the whole open issue list. Or, in core alone:

```ts
const repo = parseTree(new Map([[
  "issues/open/ab12cd34-login/issue.md",
  "---\ntitle: Login broken\nauthor: a@example.com\ncreated: 2026-01-01T00:00:00Z\n---\n\nBody.\n",
]]));
const q = emptyQuery();
q.reviews = ["pending"];
matchesQuery(q, repo.issues[0]!);   // true
```

The CLI refuses the same term: `parseQuery(["review:pending"], "issue")` → `'review:' describes a pull request; issues have no reviews`.

## Why

Three documents say it should be refused.

Spec 04 §4.3, the query grammar, uses a MUST: "`reviewer`, `review` and `awaiting` describe something only a pull request has, so `nav issue list` MUST reject them the way it rejects `status:merged`, rather than matching nothing."

`schema.graphql` claims the behaviour that is missing, on `EntityFilter.reviewers`: "This and the two below describe something only a pull request has, so `issues` rejects them rather than matching nothing."

And the CLI does reject them, so the two front ends over one grammar disagree — which is what spec 06 §6.3's "a reader of the API and a reader of `nav --json` are looking at the same thing" exists to prevent.

## What it should do

`issues` refuses `reviewers`, `reviews` and `awaiting` with `INVALID_INPUT`, in the mirror of the guard `prs` already has for `deadline`.

Worth considering instead: move the rejection into `toQuery`, which is handed the entity kind by its caller, so no future resolver can forget it. That is the shape `parseQuery` uses in core, and it is why the CLI has never had this bug.
