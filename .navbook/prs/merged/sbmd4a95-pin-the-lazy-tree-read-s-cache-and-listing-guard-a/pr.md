---
title: Pin the lazy tree read's cache and listing guard, and fail on an unlistable directory
author: Claude <noreply@anthropic.com>
created: 2026-09-27T17:12:16Z
target: dev
source: test/lazy-tree-read-contract
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
revisions:
  - head: 9f7d523cf324b34cd4a5f9906e40028836009f8c
    base: 2a881d11c08e93ae55262f5d90850ebd0d63d814
    date: 2026-09-27T17:12:16Z
  - head: 20a9dd718372619f74aa765d8e6e379c3ff3a681
    base: 16e70221cab4c4d1ceb5a7a0f00ae2f6f7d1927c
    date: 2026-09-27T17:14:43Z
  - head: f1a374cb1d9822f1d27bb62be518c662a991ea72
    base: 86ad414c8bbcbb0981eae66e832f29f32f363204
    date: 2026-09-27T19:28:24Z
merged:
  date: 2026-09-27T19:28:31Z
  by: Claude <noreply@anthropic.com>
---

Follow-up to #egvv9205. It adds the two tests worth keeping from the superseded `#d0jz7ovl` (on its own branch), and fixes the gap that reviewing them turned up.

## What changed

- **Two guarantees of the lazy `NavTree` are now asserted** (`packages/core/test/tree.test.ts`):
  - **`get` remembers a file once read.** An entity file is asked for twice, to parse it and to hash it, and both reads must see the same bytes.
  - **`get` answers `undefined` for a path the walk left out,** such as a comment outside the read's scope, rather than opening it anyway. The test reads the same comment in scope first, so the `undefined` can only come from the scope.
- **`walk` no longer swallows every `readdirSync` error** (`packages/core/src/workspace/workspace.ts`). An entity directory under `chmod 000` used to leave its issue out of the tree with no structural problem: the same outcome `ee903bf` ruled out for an unreadable file. It now throws. Only `ENOENT` and `ENOTDIR`, a directory that disappears mid-walk, are still skipped. The catch-all dated from the first commit and no comment explained it.

## Checked

- **Each new test fails under the mutation it targets, and not vacuously:**
  - Without the read cache, the cache test fails.
  - Without the listing guard, the scope test fails.
  - With `get` always answering `undefined`, both fail. That mutation was the self-review's finding against the first commit, which both tests passed.
  - With the old catch-all back in place, the directory test fails.
- **The unreadable directory was reproduced directly** before the fix: `parseTree(readNavTree(dir))` returned 0 issues and no problems.
- **biome and tsc are clean**, for every package and the root.
- **Suites pass:** core 845, server 370, plugin-kb 138, cli 393, conformance 126 and deploy 68. Deploy's web-build tests are skipped in a worktree.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
