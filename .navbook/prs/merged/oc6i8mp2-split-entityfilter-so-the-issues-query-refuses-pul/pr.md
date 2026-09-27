---
title: Split EntityFilter so the issues query refuses pull-request-only terms
author: Claude <noreply@anthropic.com>
created: 2026-09-27T11:42:32Z
target: dev
source: fix/zlr44nen-split-entity-filter
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
revisions:
  - head: 3453ff514a66bf7d303fe211501133921335e5cc
    base: 6cf8d86e47de70cc38cc851ae01f74b97228155d
    date: 2026-09-27T11:42:32Z
  - head: fc3249982941f814c30e38dde5defc2d4fb1e6b9
    base: a37e22e99c3dd3223843c1f3e55237f98fb3f500
    date: 2026-09-27T12:10:34Z
merged:
  date: 2026-09-27T12:10:44Z
  by: Claude <noreply@anthropic.com>
---

Fixes #zlr44nen (audit finding 01).

## The bug

`issues(filter: { reviews: [PENDING] })` returned **every issue**. An issue has no revisions, so its derived decision is `pending` and the term matched. `reviewers` and `awaiting` matched nothing instead of being refused. Spec 04 §4.3 forbids both behaviours, and the CLI has always refused these terms at parse time. The issue's confirmation comment has the HTTP repro.

## The fix

The structural option from the implementation plan:

- **Schema.** `EntityFilter` becomes `IssueFilter` (shared keys + `deadline`) and `PrFilter` (shared keys + `reviewers`, `reviews`, `awaiting`). GraphQL validation now refuses a term that describes the other noun (`GRAPHQL_VALIDATION_FAILED`) before any resolver runs. The schema doc that claimed `issues` refused these terms now sits on `IssueFilter` as the reason there are two inputs.
- **Server.** `toQuery` becomes `toIssueQuery` / `toPrQuery`, and each reads only its own noun's keys, so a caller that skips validation still can't ask an issue about reviews. `prs` loses its hand-written `deadline` guard, because validation now covers it.
- **Web client.** `queryToFilter` read `?reviewer=` on the issue list without a gate and sent it, so `/issues?reviewer=…` showed an empty list. It is now gated through `FilterKeys.reviewers`, the way `?deadline=` is on the PR list. `toEntityFilter` is split into `toIssueFilter` / `toPrFilter`, and `useEntityFilter` takes the listing's projection.
- **Codegen.** Regenerated for both packages. A second run changes nothing.

## Breaking change

The API changes in four ways. `@navbook/web` is the only known client and ships in lockstep with the server, but the release notes should list all four:

- Operations that name `EntityFilter` break. They must use `IssueFilter` or `PrFilter`.
- `IssueFilter.status` takes the new `IssueStatus` enum (`OPEN`, `CLOSED`). `issues(filter: { status: [MERGED] })` was accepted and matched nothing. It is now refused, as the CLI refuses `status:merged` on issues.
- `prs(filter: { deadline: … })` used to fail with `INVALID_INPUT` and the CLI's wording. It now fails with `GRAPHQL_VALIDATION_FAILED` (HTTP 400) and a message naming the field. The review terms on `issues` fail the same way.
- An **empty** key of the other noun (`deadline: []` on `prs`, `reviews: []` on `issues`) used to be accepted as "no narrowing". It is now refused as well, because validation checks that a key exists, not what it holds. A client that sends every key, using empty arrays for the unset ones, has to send only its own noun's keys.

The self-review also found two things this change leaves as they are. `?reviewer=` on the issue list stays in the address (it has no effect), as `?deadline=` already does on the PR list. And a listing's keys are declared in three places: its `FilterKeys`, its projection and `EntityFilterBar`'s props. Merging those is a refactor for another change.

## Verification

- New HTTP tests in `read.test.ts` cover `reviewers` / `reviews` / `awaiting` on `issues`, `deadline` on `prs`, and `status: [MERGED]` on `issues`. All **fail on the old code** (`INVALID_INPUT` / no error) and pass on the new.
- Unit tests for `toIssueQuery` / `toPrQuery`, including that each ignores the other noun's keys. Web unit tests cover the `?reviewer=` gate and the split projections.
- server 382 ✔, core 835 ✔, web vitest 377 ✔, conformance 124 ✔, deploy 63 ✔, web e2e (Playwright, built bundle) 153 ✔
- `biome check`, root `tsc`, server `tsc`, `nuxi typecheck`, web tools `tsc`: clean
- `nav doctor`: 0 errors, same warning count as before
