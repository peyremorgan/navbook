---
title: API
---

## What exists

`nav-server` serves one clone. Before a read it pulls, if it has not within the interval; around a write it pulls, runs the operation, commits and pushes, under one lock. A push it cannot fast-forward is retried once after a pull and then reported; a merge it cannot complete is aborted and reported. Conflicts surface; nothing is resolved on anybody's behalf (spec 06 §6.3).

- **Identity** comes from an OIDC bearer token whose `email` claim becomes `author:`; the machine account is the committer. There is no authorization: any token the issuer signs for the audience may write.
- **Reads** — `issues`, `issue`, `prs` (with `allRefs` for the cross-branch scan), `pr`, `features`, `feature`, `doctor`, `viewer`, `reviewPolicy`. A listing is the whole matching set; there is no pagination.
- **Reviews** — `Pr.reviewDecision` follows the policy `reviewPolicy` reports (spec 02 §2.10), and `Pr.approvals` says how many approvals it counted against how many were asked for, so a client can explain a pending badge rather than only draw one. A policy nobody can read is served, not raised: `problems` says what was wrong while every field beside it holds the default. Nothing here is a gate, and there is nothing for one to gate — merging is not exposed.
- **Writes** — `openIssue`, `updateIssue`, `closeIssue`, `reopenIssue`, `updatePr`, `addComment`, `linkIssue`, `unlinkIssue`, `createFeature`, `updateFeature`, `addSpec`, `updateSpec`. Every payload returns `commit { committed subject pushed }`, and a client is expected to say so when `pushed` is false.
- **Composing** stays on the server: a client sends fields, the server builds the file with core's constructors and validates it before anything is written.
- **Patches** distinguish absent from `null`; unknown frontmatter keys always survive.
- **Refusals** — `REPARENT_REQUIRED` for a link that would move a subtask, `PRECONDITION` for a comment or a patch on a pull-request branch this clone does not serve, `STALE_CONTENT` for a document save made against a version somebody has replaced.
- **Not exposed** — opening a pull request, appending a revision to one, merging it; deleting anything; `init`; `doctor --fix`; renaming or removing a feature or document. A pull request's metadata is patchable, `reviewers` included.

## Where it lives

- `packages/server/schema.graphql`, `src/resolvers/`, `src/sync.ts`, `src/lock.ts`, `src/auth.ts`, `src/patch.ts`
- Tests spawn a real server against a bare origin and two clones: `packages/server/test/`

## Drift from the specification

- Spec 06 §6.3 says what reaches the browser "is the canonical JSON projection of 04 §4.2". The schema is a projection of the same records but not the same shape: `assignee` becomes `assignees`, `feature` becomes `features`, statuses and kinds are uppercase enums, and pull requests carry a `refs` field the projection does not have. A reader of the API and a reader of `nav --json` are looking at the same data under different names.
