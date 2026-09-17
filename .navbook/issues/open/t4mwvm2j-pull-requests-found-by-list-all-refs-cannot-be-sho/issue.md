---
title: Pull requests found by list --all-refs cannot be shown or reviewed from another branch
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-13T10:10:32Z
labels: [bug]
feature: [pull-requests, cli]
---

Reported by an agent reviewing a pull request from its own worktree.

`nav pr list --all-refs` found #sf9fu6z4 (source `feat/inventory-transfers`, target `dev`) and showed the reporter as a pending reviewer. Nothing it printed could then be used to act on it:

- `nav pr show sf9fu6z4` → `nav: no pull request matches 'sf9fu6z4'`
- `nav pr show '#sf9fu6z4'` → the same
- `nav pr review .navbook/prs/open/sf9fu6z4-feat-inventory-phase-3-inter-site-transfers-and-pr ...` (the `path` from `--json`) → the same
- `nav pr review sf9fu6z4 --revision 79295b8a… --request-changes -m …` → the same

The review could not be filed, and nothing said why or where to go.

## Why

The listing and the verbs look in different places. `list --all-refs`, `merge` and `close` go through the cross-ref scan (`scanRefsForOpenPrs` / `locatePr`). `show`, `review`, `comment`, `edit`, `update` and `request` go through `resolveEntity`, which reads the checked-out tree and nothing else. A pull request's files live on its source branch (spec 03 §3.5), so from any other checkout, and in particular any other worktree, the listing's IDs do not resolve for those verbs. The error is the one for an ID that exists nowhere.

The server has already been through this. The `pr` query falls back to `locatePr` when the tree does not hold the pull request. `writeTarget` refuses a write to one on another branch with a precondition naming that branch, because a comment written here would land in a directory with no `pr.md` beside it (the stranded-comment fault of spec 03 §3.3.1). The CLI does neither.

Two smaller things got in the way too:

- The listing prints `#sf9fu6z4`, but a leading `#` is not accepted as part of an ID.
- `--json` reports `path` (`.navbook/prs/open/<id>-<slug>`), but only the bare `<id>-<slug>` directory name is accepted.

## What it should do

- `nav pr show <id>` reads a pull request from the branch that carries it when this tree does not hold it, and says which branch that was.
- The verbs that write into the pull request's directory refuse with a precondition naming the branch that holds it, and the worktree that has it checked out if there is one, so the next command is obvious.
- `#<id>` and a path ending in `<id>-<slug>` resolve wherever an ID does.
