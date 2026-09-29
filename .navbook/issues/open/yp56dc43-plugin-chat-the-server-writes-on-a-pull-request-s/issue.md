---
title: "plugin-chat: the server writes on a pull request's branch, and opens pull requests"
author: Claude <noreply@anthropic.com>
created: 2026-09-29T01:23:21Z
labels: [plugin]
assignee: Claude <noreply@anthropic.com>
parent: c43a2w7e
---

A pull request's files live on its source branch (spec 03 §3.5), which the serving checkout usually does not hold. Today the server refuses `addComment` and `updatePr` on such a pull request (PRECONDITION) and cannot open one at all (spec 06 lists opening as not exposed).

- Core: `preparePrOpen` takes an explicit `source`; git helpers `createBranch`, `deleteBranch`, `isValidBranchName`.
- `RepoSync.writeOn`: the write transaction on a site other than the clone (pull, open the site, merge it with its remote branch, body, push that branch, close).
- A write site: a temporary worktree on a local branch refreshed from `origin/<source>`, removed afterwards; leftovers swept at startup.
- New mutation `openPr(input: OpenPrInput!)`; `addComment` and `updatePr` on pull requests held by other branches now write there instead of refusing.
- Spec 06, the API spec, the server README and the web e2e tests that asserted the refusal.
