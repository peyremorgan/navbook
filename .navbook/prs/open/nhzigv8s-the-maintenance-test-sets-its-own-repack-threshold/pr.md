---
title: The maintenance test sets its own repack threshold, which git 2.56 raised
author: Claude <noreply@anthropic.com>
created: 2026-10-14T00:12:28Z
target: dev
source: fix/s9qwm9vd-maintenance-geometric-threshold
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: f67b1470eec73473b78170a81d6cf77bd831cb4b
    base: 4f9199ada8754a9257ff5bc926a663f7080ecca4
    date: 2026-10-14T00:12:28Z
  - head: 8772db1ffe4b146f175ae2a6dea9c042b98e5940
    base: 4f9199ada8754a9257ff5bc926a663f7080ecca4
    date: 2026-10-14T00:19:14Z
---

Closes #s9qwm9vd.

`maintenance.test.ts` "packs what it finds, in the foreground" failed on every run with git 2.56.0 (`3003 !== 0` loose objects). This is a test fix; the server is unchanged.

## Cause

Since git 2.54, `git maintenance run --auto` (the server's `MAINTENANCE_ARGS`) runs the geometric strategy by default. Its repack task acts once the loose objects exceed `maintenance.geometric-repack.auto`, rounded up to a multiple of 256. Git 2.56 moved that default from 100 (`builtin/gc.c` in v2.55.0) to 6700 (`odb/source-files.c` in v2.56.0): "adjusted to match that of 'git gc --auto', preventing over-aggressive repacking during concurrent writes". The test makes 3000 loose objects, which no longer clear it, so `--auto` decides there is nothing to do. The issue's comment quotes both versions of the code.

## Fix

The test's git now has configuration of its own:

- **A threshold:** `maintenance.geometric-repack.auto=100` for the geometric strategy, and `gc.auto=100` for the `gc` task. That task was the default before 2.54 and is still used under `maintenance.strategy=gc`.
- **No machine config:** `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`, so a `maintenance.*` setting in somebody's `~/.gitconfig` can't decide what `--auto` does.
- **Built with the server's own helpers** (`disableAutoMaintenance`, `appendGitConfig`), so `GIT_CONFIG_*` entries the environment already carries are kept rather than overwritten.

The test still proves what it says: the run stays in the foreground, and when `stop()` returns, it has packed everything.

`MAINTENANCE_ARGS` keeps git's default. Git raised it to avoid repacking during concurrent writes, which is the situation of the server's clone.

## Self-review (2026-10-14)

`/code-review high` found no bug in the threshold fix itself, and these around it, all now fixed:

- **Not hermetic.** The test still read the machine's git config. Checked: with `maintenance.geometric-repack.enabled = false` in a global config, the first version of this fix fails and the current one passes.
- **Inherited entries overwritten.** The env was written from `GIT_CONFIG_KEY_0` onwards, overwriting what was already there. Checked: the test passes under this repo's `GIT_CONFIG_COUNT=2` identity prefix.
- **Wrong comment about `gc.auto`.** Both the test comment and the issue comment said a 2.56 git ignores `gc.auto`. It doesn't: its `gc` task reads it. Checked: under `maintenance.strategy=gc`, the test passes with `gc.auto=100` and fails without it. Both comments are corrected.
- **Wrong comment about sampling.** Git estimates the loose count from one fixed directory, `objects/17`, not one of 256 at random. The comment now says so, and that the test puts nine objects there.

## Tests

- Server: 504 of 504 pass.
- The test passes repeatedly.
- With the geometric key set to `6700` (git 2.56's default), the test fails again with `3003 !== 0`, so the pinned threshold is what makes it pass.

Not run on a git older than 2.54. The `gc` path was exercised on 2.56 through `maintenance.strategy=gc` instead.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
