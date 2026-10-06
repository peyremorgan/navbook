---
title: 'test(server): unset TMPDIR again rather than setting it to "undefined"'
author: Claude <noreply@anthropic.com>
created: 2026-10-06T23:35:43Z
target: dev
source: fix/tmpdir-restore
reviewer: morgan.peyre@brickcode.tech
labels: [bug, release]
revisions:
  - head: 3b9069e2502fa4ba81b2c06efdfcf22dac5f404a
    base: 84a2eddf331e3c65731c7caf362c1c4edd769534
    date: 2026-10-06T23:35:43Z
---

Unblocks the v0.6.0 release. `release.yml` failed at `pnpm test`, before any publish step, so nothing reached npm. The same failure took down CI's two Ubuntu test jobs and the built-server suite in "build + pack smoke test".

## Why

`write-site.test.ts` › "takes away the copy it made when the worktree cannot be made" points `TMPDIR` at a missing directory, then restored it with `process.env.TMPDIR = saved`. On CI's Ubuntu runners `TMPDIR` is unset, so `saved` is `undefined`, and assigning `undefined` to `process.env` stores the string `"undefined"`. The next test's `tmpdir()` was then `undefined`, and `openWriteSite` failed with `ENOENT … mkdtemp 'undefined/nav-server-wt-left-XXXXXX'`.

macOS always sets `TMPDIR`, which is why the macOS jobs and the local dry run passed. The test came in with #lfr46mfi after v0.5.0, so this is its first CI run on Linux. Production code is not affected.

## Change

- The restore deletes `TMPDIR` when it was unset, as `leftovers.test.ts` already does for `GIT_OBJECT_DIRECTORY`. A search of every test for the same pattern found no other case.

## Tests

- Reproduced locally with `env -u TMPDIR`: the same `undefined/nav-server-wt-left-…` error before the fix, and 4/4 after it, with `TMPDIR` both unset and set.
- Every node suite with `TMPDIR` unset: core 956, cli 437, plugin-kb 145, plugin-tests 120 and plugin-chat 149 pass. Server passes 491, with 1 skipped and 1 failure, the maintenance packing test, which fails because of Apple Git 2.50.1 here and passes on CI's git (it was green on Ubuntu for v0.5.0).
- Biome is clean.

## Not covered here

The Windows job, "test (node 24, windows-latest, Git Bash)", also failed, in the core/cli/plugin-kb/plugin-tests step. This fix does not touch those suites, and the job log needs signing in to read, so that failure is still unknown.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
