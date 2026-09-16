---
title: Fast-forward the source branch after nav pr merge
author: Claude <noreply@anthropic.com>
created: 2026-09-16T08:09:54Z
target: dev
source: fix/en1bjq9j-sync-source-after-merge
reviewer: morgan.peyre@brickcode.tech
labels: [enhancement]
revisions:
  - head: b012572a958e59dbb4b3bbc899759a15ff207ebb
    base: 08ef78be5be4877ab0bac5a5d2a901aecfc19889
    date: 2026-09-16T08:09:54Z
  - head: cbbbbb51c6de1d21188dda596c2109213ab10031
    base: 0427d4f9e79fc6aa10d5fbd4555234a9f83cac68
    date: 2026-09-16T11:03:50Z
---

Fixes #en1bjq9j.

`nav pr merge` records the archive commit on the target alone, so merging a long-lived branch such as `dev` into `main` left `dev` one commit behind, and `nav pr list --all-refs` showed the same pull request `merged` on `main` and `open` on `dev`.

## What changes

- After the merge is recorded, core's merge operation fast-forwards the source branch to the target and reports what it did on the result (`MergeResult.source`). The CLI prints `Fast-forwarded <source> to <target>`.
- It is a fast-forward of a local branch or nothing: a remote-tracking ref or an absent branch is left alone silently; a branch with commits the target lacks, or one checked out in another worktree, is left alone with a warning saying what to do. No merge, no commit, no conflict is ever produced on the source.
- The move uses `git update-ref` with the expected old value rather than `git branch -f`, which refuses any branch checked out in a worktree and offers no compare-and-swap. The worktree check is explicit, from `git worktree list --porcelain`.
- `--no-sync-source` keeps the old behaviour. `--continue` performs the same step.
- Spec 04 documents the behaviour and the flag; spec 01 and the README mention it. The four `pr-merge` conformance fixtures gain the new stdout line and a fifth pins `--no-sync-source`.

## Notes for review

- After `nav pr merge` the source is always an ancestor of the target, because the merge consumes the ref's current tip. The `diverged` outcome is therefore a guard for the ref moving between the merge and the sync, which is reachable through `--continue`; the CLI test moves the ref with `update-ref` while the conflict is unresolved to exercise it.
- One existing CLI test relied on the stale source branch to merge twice; it now uses `--no-sync-source`, and a new test covers the default, where the second attempt finds no open pull request anywhere.
- The doctor check the issue floats as an open question (a PR merged on its target and open on another fetched ref) is not part of this change.

## Verification

- core: 696 tests pass; cli: 307 pass; conformance: 115 pass, including the new fixture.
- `tsc --noEmit` on core, cli and server; `biome check` clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
