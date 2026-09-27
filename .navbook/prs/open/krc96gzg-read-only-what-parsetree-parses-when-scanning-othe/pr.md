---
title: Read only what parseTree parses when scanning other branches for pull requests
author: Claude <noreply@anthropic.com>
created: 2026-09-27T17:19:50Z
target: dev
source: fix/u0a6u6ev-scan-only-parsed-blobs
reviewer: morgan.peyre@brickcode.tech
labels: [performance, bug]
revisions:
  - head: de4869a5bca652404d18546dbba35fee25e3e3f7
    base: 5a7718e8e09e5677bb4bbd5d8357056dd6e7dc4a
    date: 2026-09-27T17:19:50Z
  - head: ee8beaf6008c4bd62adadbf17acea4cbf3ee414b
    base: e91a2aad24734a50699f89447bb982a0702ebe5e
    date: 2026-09-27T20:08:03Z
---

Fixes #u0a6u6ev.

## Problem

`scanRefsForOpenPrs`, which backs `nav pr list --all-refs`, `pr show`/`review` from another branch, and `pr merge`, asked `cat-file` for **every** blob in each open pull request's directory, once for each ref carrying it. It then parsed only `pr.md` and `comments/*.md`. Everything in the §2.12 per-entity namespace (`reports.json`, `<short>/`) was read and UTF-8 decoded, then thrown away.

`catBlobs` also returned an empty map on any failure. A PR directory holding more than 256 MB made `spawnSync` fail with `ENOBUFS`, so `pr.md` looked absent and the pull request vanished from the listing, `show` and `merge`, with exit 0 and no message. Both are reproduced in the issue's comments.

## Change

- **`parsedPaths(keys, { ext })`** in `core/tree.ts` lists the files `parseTree` may read: the marker, entity files, comments, and registered extension locations. It runs the same `classify` pass as `parseTree` (factored out as `classifyAll`), so there is still one reader of the entity-directory grammar. This is the concern the issue raised about option 2. A contract test runs `parseTree` over a recording tree, covering every shape `classify` handles, with and without a plugin location, and checks that it never reads outside `parsedPaths`. Deleting the comment paths from `parsedPaths` makes it fail.
- **`scanRefsForOpenPrs`** now works in three steps:
  1. resolve every ref's `prs/open` to a tree in one `cat-file --batch-check`, the approach `countOpenPrsOnOtherRefs` already uses;
  2. `ls-tree -r` each *distinct* tree once;
  3. read the parsed files of all trees in **one** `cat-file --batch`.

  The namespace is still listed, so `extraFiles` is unchanged, and it is never read. Refs that share a tree, such as a branch and its `origin/` copy, now cost one read between them.
- **`catBlobs` and `batchResolve` throw** on a spawn error, `ENOBUFS` or a non-zero exit (`GitError`, or a message naming the byte limit). A missing object still just leaves its entry out, which is the normal case for a ref without the directory.

## Measurements

The repro from the issue: one PR with a comment, a `reports.json` and a binary `reports/trace.bin`, on `feat/x`, `feat/y` and `origin/feat/x`. Requests were counted with a logging `git` wrapper.

| | before (`dev`) | after |
|---|---|---|
| `reports.json` / `trace.bin` requested | 3 × each | 0 |
| `pr.md` / comment requested | 3 × each | 1 × each |
| git processes for `pr list --all-refs` | 18 | 12 |
| 270 MB `reports/big.bin` on all three refs | "No pull requests match", exit 0 | PR listed on all three refs; `pr show` works |

At a larger scale, 20 PR branches each with an `origin/` copy and a 270 KB `reports.json`: `pr list --all-refs` goes from **903 to 217** git `execve` calls under strace, and from **2.29 s to 1.66 s** averaged over 5 runs. It lists the same 20 PRs.

## Tests

- `core/test/tree.test.ts`, `parsedPaths`: the contract, the exact set for a mixed tree, and a plugin location's files being handed over whole.
- `core/test/operations.test.ts`:
  - *never reads an open pull request's extension namespace off other refs* puts a `git` shim on `PATH` that logs `cat-file --batch` stdin. It asserts that `reports.json` is never requested, that the PR is still found on all three refs with `reports.json` in `extraFiles`, and that `pr.md` is read once.
  - *reports a batch it could not read* makes the shim fail `--batch-check`, then `--batch`, and expects a `GitError` from each.

  Both tests fail against `dev`'s implementation: the first because `reports.json` is requested three times, the second because no error is thrown.

Full run on the branch (run directly, not through root pnpm scripts):
- typecheck: root, core, cli, server and plugin-kb clean
- biome: clean
- tests: core 847, cli 393, server 370, plugin-kb 138, conformance 126, deploy 68; 0 failures

Not changed: `doctor --staged` (#j35o7oe4) has the same shape of problem against the index. `parsedPaths` is the piece that fix could reuse for its "part 2".

🤖 Generated with [Claude Code](https://claude.com/claude-code)
