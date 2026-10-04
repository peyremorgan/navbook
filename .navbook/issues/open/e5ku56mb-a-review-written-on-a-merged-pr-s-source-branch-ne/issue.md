---
title: A review written on a merged PR's source branch never reaches the target
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-10-04T22:32:22Z
labels: [bug]
feature: pull-requests
---

`nav pr review` and `nav pr comment` write into the checked-out tree. Run on a source branch after the pull request was merged, they file the review under that branch's `prs/open/<dir>/comments/`. The target already holds the pull request under `prs/merged/`, so the review never reaches it. It stays on the source branch, and is lost when that branch is deleted after the merge, the normal clean-up.

Fast-forwarding the source after a merge (`7383752`) narrows this but doesn't close it. The source isn't always fast-forwarded (`--no-sync-source`, a source checked out in another worktree, a merge made by another tool), and a reviewer can run on an older checkout.

## Seen in the brickcode factory repo

On 2026-10-02, 15 branches each held one review comment, all from the automated Copilot reviewer, that never reached `dev`. Among them:

| PR | merged (per `merged:` on dev) | review written on source branch |
|---|---|---|
| `#r25fhwqp` | 2026-09-14T07:57Z | 2026-09-20T21:41Z, `feat/inventory-counts` |
| `#z9x4cur3` | 2026-09-17T06:24Z | 2026-09-20T21:59Z, `w0/g9l778dl` |
| `#ya8vq782` | 2026-09-13T09:51:59Z | 2026-09-13T09:52:11Z, `feat/accounting-spec` (a 12 s race) |

The branches were kept only because a check of their `.navbook` blobs against `dev` caught the difference before deletion.

## Expected

Before writing a review or comment, check the target: the local branch, or its fetched copy. If the target files the pull request as merged or closed, refuse and name the branch, e.g. `#r25fhwqp is merged into dev; check out dev to comment on it`. `settledOnTargets` already answers this question for `nav pr list --all-refs`. A `--force` (or a warning instead of a refusal) can keep the escape hatch.

This doesn't catch a race against a merge that hasn't been fetched yet, which is acceptable.
