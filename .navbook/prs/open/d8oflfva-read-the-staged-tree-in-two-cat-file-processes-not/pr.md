---
title: Read the staged tree in two cat-file processes, not one per file
author: Claude <noreply@anthropic.com>
created: 2026-09-27T17:21:36Z
target: dev
source: fix/j35o7oe4-batch-staged-reads
reviewer: morgan.peyre@brickcode.tech
labels: [performance]
revisions:
  - head: bbfe0d508075b0e1c07c3a81207e3925cf81de8a
    base: 5a7718e8e09e5677bb4bbd5d8357056dd6e7dc4a
    date: 2026-09-27T17:21:36Z
---

Fixes #j35o7oe4. `nav doctor --staged`, which the pre-commit hook runs, read each indexed Navbook file with its own `git show :<path>`. On this repository that meant 312 processes, about 3 s on every commit, and the cost grew with every comment and every file of extension data.

## What changes

`stagedRepo` now builds its tree through `stagedTree` (`packages/core/src/git/index-ops.ts`):

- One `git cat-file --batch-check` over `:<path>` gives each staged blob's size. A path with no blob at stage 0 (a staged deletion, a conflicted path) answers `missing` and is left out, exactly as a failing `git show` left it out.
- One `git cat-file --batch`, through the existing `catBlobs` with an empty ref, reads every blob up to 1 MiB.
- A larger blob is read only when `parseTree` asks for it. That is part 2 of the issue: extension data under §2.12, or an image, is listed in `reserved` and never read.
- `catBlobs` answers a failed batch with an empty map, which would let the hook pass a tree with files missing. So every blob the check found must come back from the batch, or `stagedTree` throws.
- A path with a newline in it (legal in git) cannot go through the line-based batch, so it is read with `git show` on its own.

`refscan.ts` is deliberately untouched: #u0a6u6ev is changing `catBlobs` to throw on failure. The completeness check here stays correct either way.

## Measured on this repository

| | before | after |
|---|---|---|
| git processes | 314 (312 × `show`) | 4 (`rev-parse`, `ls-files`, `cat-file --batch-check`, `cat-file --batch`) |
| `doctor --staged` | 3.1–3.7 s | 0.5–0.8 s (the upper end measured under load from parallel test runs) |
| `doctor --staged --json` output | | byte-identical |

## Tests

- `packages/cli/test/cli/doctor.test.ts`:
  - **fixed number of git processes:** 40 staged comments, counted through `GIT_TRACE`, with no `git show` at all. Fails on the old code.
  - **large files:** a 2 MiB `reports/run.json` is never read, by name or by object name, and a 2 MiB broken `issue.md` is still read and judged (exit 2). Fails on the old code.
  - **deletions and odd names:** a staged deletion and a path containing a newline leave a clean tree.
- `packages/core/test/staged-tree.test.ts`: staged content rather than the working tree, the prefix is stripped, missing paths are left out, and a git that cannot read the index throws.
- Full suites in the worktree: core 845, CLI 396, conformance 126, plugin-kb 138. All pass, with biome and tsc clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
