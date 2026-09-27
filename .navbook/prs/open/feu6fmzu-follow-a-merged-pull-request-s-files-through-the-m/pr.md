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
---

Fixes #f2dnig9s. `nav doctor` on `dev` gave two D10 warnings, for #x1nqfqsq and #z3j95v3e. Both `created:` values are correct. The check was dating each file from the wrong commit.

## Cause

`nav pr merge` moves `pr.md` and the comments from `prs/open/` to `prs/merged/` inside the merge commit. `git log` does not diff merges, so `git log --follow` never sees that rename. `fileVersions` therefore started at the first commit after the merge (the `docs(pr): merge` edit), or returned nothing when no later commit touched the file, as for most merged-PR comments. D10 then compared `created:` with the merge date. D7 and the link-conflict scan read the same shortened history.

## Change

`packages/core/src/git/history.ts`: `fileVersions` still runs `git log --follow`, now with `--name-status`. A complete history opens on an `A`, `R` or `C`. If it opens on anything else, or is empty, the history was cut short at a merge, and `throughMerge` fills in the rest:

1. Plain `git log -- <path>` does list a merge whose parents both lack the path, so the oldest commit it names is that merge.
2. The merge's `git diff -M` against each parent gives the file's earlier name.
3. The history continues from that parent under that name, recursively.

I first tried `git log --follow -m`, and it was wrong. Diffed against the parent that lacks the file, the merge pairs it with any similar file that parent holds. In this repository, a comment on #cl15lj69 was matched to a 54%-similar comment on #zno8oe2q, and D10 reported it as 207h off. The third test below covers that case.

## Tests

In `packages/core/test/history.test.ts`, each test builds a real repository:

- a file moved inside a merge with no later edit (the empty-history case)
- the same with a later edit (the #z3j95v3e case)
- a later unrelated merge whose other side holds a similar file (the `-m` case)
- a path no commit has held

The first two fail on `dev`.

## Verification

- `nav doctor` from this branch on this tree: both D10 warnings are gone and nothing new appears. The D8 count is unchanged; #t1kpljkt covers those.
- `biome check .` and `tsc --noEmit` (root and core) are clean.
- Suites: core 767, cli 357, server 375, conformance 119, all passing.
- `nav doctor` takes 8.5s before and 8.9s after. The fallback runs only for histories that were cut short.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
