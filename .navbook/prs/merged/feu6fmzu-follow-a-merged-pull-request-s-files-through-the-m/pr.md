---
title: Follow a merged pull request's files through the merge that moved them
author: Claude <noreply@anthropic.com>
created: 2026-09-27T02:37:28Z
target: dev
source: fix/f2dnig9s-follow-merges
reviewer: morgan.peyre@brickcode.tech
labels: [bug, doctor]
assignee: Claude <noreply@anthropic.com>
feature: doctor
revisions:
  - head: fb554362225a6bd03256cbc12663270ef8a4c12b
    base: 8e250bb0676e102bd49e80cea0d49316510d7e1b
    date: 2026-09-27T02:37:28Z
  - head: 5a79d9f46b784b2bd67c76d8508f120d862e10f8
    base: 06627058b2477b40c8a50cfc7c2efa40f5e97e59
    date: 2026-09-27T03:19:16Z
merged:
  date: 2026-09-27T08:50:17Z
  by: Claude <noreply@anthropic.com>
  commit: d2092837d9e3add6c4509ab563aec338d2fd56a8
---

Fixes #f2dnig9s. `nav doctor` on `dev` gave two D10 warnings, for #x1nqfqsq and #z3j95v3e. Both `created:` values are correct. The check was dating each file from the wrong commit.

## Cause

`nav pr merge` moves `pr.md` and the comments from `prs/open/` to `prs/merged/` inside the merge commit. `git log` does not diff merges, so `git log --follow` never sees that rename. `fileVersions` therefore started at the first commit after the merge (the `docs(pr): merge` edit), or returned nothing when no later commit touched the file, as for most merged-PR comments. D10 then compared `created:` with the merge date. D7 and the link-conflict scan read the same shortened history.

## Change

In `packages/core/src/git/history.ts`, `fileVersions` still runs `git log --follow`, now with `-z --name-status`.

- **Complete histories.** A history that opens on an `A` (add) or a `C` (copy) is complete.
- **Copies.** `--follow` reads a new file that closely resembles an older one as a copy, and would otherwise continue into the older file's history. A copy is where a file begins, so the history stops there.
- **Resuming.** Any other opening (an edit, a rename, or nothing at all) means the history was cut at a merge. `throughMerge` resumes from the parent of the oldest commit, under the path the file had there:
  1. `git log -n1 -- <path>` names the nearest commit that brought the path in. When no parent holds the path, that commit is the merge.
  2. The merge is diffed against each parent, last parent first. The parent whose diff shows the path as a modification or the highest-scoring rename wins. An exact match ends the search.
  3. The history continues from that parent under that name. This is recursive, so chained moves work.
- **Caching.** Each merge-against-parent diff is cached, keeping the last 32. Every file a merge moved asks for the same diff.

I first tried `git log --follow -m`, and it was wrong. Diffed against the parent that lacks the file, the merge pairs it with any similar file that parent holds. That is why the parents are compared by score here.

## Tests

In `packages/core/test/history.test.ts`, each test builds a real repository:

- a move inside a merge with no later edit
- the same with a later edit
- a lookalike in the first parent that the branch deleted
- a rename after the merge move
- two merge-time moves in a row
- a new file that git reads as a copy
- a later unrelated merge
- a path no commit has held

## Verification

- `nav doctor` from this branch on current `dev`: both D10 warnings are gone and nothing new appears. That includes a #cl15lj69 comment that an intermediate version had mispaired.
- `biome check .` and `tsc --noEmit` (root and core) are clean.
- Suites: core 804, cli 363, server 377, conformance 119, all passing.
- `nav doctor` takes 8.0s before and 9.6s after, because merged-PR comments that used to go undated now go through the fallback.

## Review

`/code-review high` found six problems in revision 1: the first parent was trusted, a rename opening was trusted, the oldest commit was taken instead of the nearest merge, diffs were repeated, paths could come back quoted, and there were too few tests. All are fixed in revision 2, as described above.

Two review points I didn't adopt:
- **Parsing `git diff` in `diff.ts`.** `diff.ts` imports from `history.ts`, and its `ChangedFile` doesn't carry the similarity score the parent choice needs.
- **Mapping `merged/<dir>` back to `open/<dir>` directly.** `fileVersions` is plain git and knows nothing about entity layout. Every merge `nav pr merge` makes is an exact rename, so the score is never in doubt.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
