---
title: "test(cli): point Windows' TEMP at the private temp dir too"
author: Claude <noreply@anthropic.com>
created: 2026-10-06T23:39:53Z
target: dev
source: fix/windows-temp-env
reviewer: morgan.peyre@brickcode.tech
labels: [bug, release]
revisions:
  - head: 3ecb056b46936a9e8cc9b1126c90876cab541f33
    base: 5cab7cab1fca89c68e00abfa064d871f46568bba
    date: 2026-10-06T23:39:53Z
merged:
  date: 2026-10-06T23:39:59Z
  by: Claude <noreply@anthropic.com>
---

Fixes the one failure in CI's "test (node 24, windows-latest, Git Bash)" job on `main` at 84a2edd. This is the second and last fix before 0.6.1.

## Why

`plugins.test.ts` › "refuses a write that returns a promise, keeping the worktree with what it staged" points the CLI's temporary worktree at a private directory with `TMPDIR`, then lists that directory to find what was kept. Node's `os.tmpdir()` reads `TMPDIR` only on POSIX. On Windows it reads `TEMP`, then `TMP`, so the worktree went to the runner's own temp directory and the test failed with "the temporary worktree is gone". The CLI did keep the worktree, just somewhere else. The CLI itself is not affected: `pr-elsewhere.ts` uses `tmpdir()`, which follows each platform's convention.

## Change

- The test also passes `TEMP` and `TMP`, so the worktree lands in its directory on both platforms.

## Tests

- The test passes on macOS with `TMPDIR` set and unset, and Biome is clean.
- It has not been run on Windows. The next CI run on `main` is the check.

## Worth knowing

- **Other tests may not check what they say on Windows.** Several tests in `pr.test.ts`, and one in plugin-chat's `cli.test.ts`, also name their private directory with `TMPDIR` only. On Windows they pass without checking anything: they assert the directory ends up *empty*, and with the worktree elsewhere, it always is. Making them check something on Windows would be a separate change.
- **The Windows job stopped at the CLI.** `pnpm -r` stopped at the first failing package, so plugin-kb, plugin-tests and `test:conformance` did not run on Windows at 84a2edd. They may still have failures of their own. The release workflow runs on Ubuntu only, so none of this blocks publishing.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
