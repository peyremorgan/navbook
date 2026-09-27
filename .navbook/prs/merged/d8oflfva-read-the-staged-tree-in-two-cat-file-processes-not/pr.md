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
  - head: 8cbf86f1fc5f1fa86f75f68c313493822cd08d79
    base: a0471142f46e6ac655a84b020703864e91c6c91e
    date: 2026-09-27T19:53:56Z
  - head: 568edacefd4a633981af13ceb61f32ce9165d393
    base: a0471142f46e6ac655a84b020703864e91c6c91e
    date: 2026-09-27T19:54:37Z
merged:
  date: 2026-09-27T19:55:09Z
  by: Claude <noreply@anthropic.com>
---

Fixes #j35o7oe4. `nav doctor --staged`, which the pre-commit hook runs, read each indexed Navbook file with its own `git show :<path>`. On this repository that meant 312 processes, about 3 s on every commit, and the cost grew with every comment and every file of extension data.

## What changes

`stagedRepo` now builds its tree through `stagedTree(cwd, dir)` in `packages/core/src/git/index-ops.ts`:

- `git ls-files --stage -z -- <dir>` lists the stage-0 entries with their SHAs.
  - A staged deletion, a conflicted path (no stage 0) and a submodule are left out, as a failing `git show` left them out.
  - This replaces `allIndexedNavPaths` and its `stagedPaths` fallback. That fallback only ever listed paths the index no longer held, so it always produced an empty tree.
- One `git cat-file --batch-check`, given SHAs, sizes every blob.
- `git cat-file --batch`, given SHAs, reads every blob up to 1 MiB. The reads are split into chunks of at most 64 MiB, each with a buffer sized from the known lengths, so a large index costs a few more processes instead of overflowing.
- A larger blob is read with `git cat-file blob <sha>` only when `parseTree` asks for it. So a big report under §2.12, or an image, is listed in `reserved` and never read. A small one rides along in the batch, where it costs bytes rather than a process.
- Objects are asked for by name, never by path, so no answer from git carries a path, and every header is checked against the SHA asked for. A blob that does not come back throws, rather than letting the hook pass a tree with files missing.

`refscan.ts` and `catBlobs` are untouched, because #u0a6u6ev (PR `krc96gzg`) is changing them. `catBlobs` keys its answers by `<ref>:<path>`, so it could not take SHAs anyway.

## Self-review (commit `fix(core): read the staged tree by object name…`)

The first revision asked `cat-file` for `:<path>` specs, which caused three problems:
- A `missing` line echoes the spec, so a deleted path named `x blob 5` parsed as a present blob and failed the hook.
- Paths containing a newline needed a separate `git show`.
- A single `catBlobs` batch capped at 256 MB answered an overflow with `{}`.

Its "never read" test also could not see batched reads, because GIT_TRACE does not log stdin. All four are fixed above.

Two review points are deliberately kept:
- A large blob that cannot be fetched on demand throws, as `readNavTree` does.
- The small lazy-tree duplication with `readNavTree` stays.

## Measured on this repository

| | before | after |
|---|---|---|
| git processes | 314 (312 × `show`) | 4 (`rev-parse`, `ls-files --stage`, `cat-file --batch-check`, `cat-file --batch`) |
| `doctor --staged` | 3.1–3.7 s | 0.56 s |
| `doctor --staged --json` output | | byte-identical to `dev` |

## Tests

- `packages/cli/test/cli/doctor.test.ts`:
  - **Fixed number of git processes:** 40 staged comments, and no `git show` at all. Fails on the old code.
  - **Large files:** a 2 MiB `reports/run.json` is never read. This is checked in the batch input, recorded by a `git` wrapper on PATH, and in GIT_TRACE. A 2 MiB broken `issue.md` is still read and judged (exit 2). Fails on the old code, and fails if the prefetch limit is raised to take the report in.
  - **Deletions and odd names:** a staged deletion and a path containing a newline leave a clean tree.
- `packages/core/test/staged-tree.test.ts`:
  - staged content rather than the working tree, keyed below the directory;
  - a deleted `gone blob 5` and a newline path are both handled;
  - with limits shrunk, 30 bytes of small blobs take two batches and a large blob is read once, on demand;
  - a git that cannot read the index throws.
- Full suites in the worktree after the self-review fix: core 849, CLI 396, conformance 126, plugin-kb 138. All pass, with biome and tsc clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
