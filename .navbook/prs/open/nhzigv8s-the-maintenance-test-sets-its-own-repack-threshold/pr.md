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
---

Closes #s9qwm9vd.

`maintenance.test.ts` "packs what it finds, in the foreground" failed on every run with git 2.56.0 (`3003 !== 0` loose objects). This is a test fix; the server is unchanged.

## Cause

`git maintenance run --auto` (the server's `MAINTENANCE_ARGS`) runs the geometric strategy by default. Its repack task acts once the loose objects exceed `maintenance.geometric-repack.auto`, rounded up to a multiple of 256. Git 2.56 moved that default from 100 (`builtin/gc.c` in v2.55.0) to 6700 (`odb/source-files.c` in v2.56.0): "adjusted to match that of 'git gc --auto', preventing over-aggressive repacking during concurrent writes". The test makes 3000 loose objects, which no longer clear it, so `--auto` decides there is nothing to do. The issue's comment quotes both versions of the code.

## Fix

The test's git config gains `maintenance.geometric-repack.auto=100`, and `gc.auto=100` for a git whose default maintenance task is still `gc`. Each git ignores the key it doesn't read. The threshold is now the test's own (256 loose objects) rather than whatever git ships. The test still proves what it says: the run stays in the foreground, and when `stop()` returns, it has packed everything.

`MAINTENANCE_ARGS` keeps git's default. Git raised it to avoid repacking during concurrent writes, which is the situation of the server's clone, and a server packing loose objects later is git's own choice.

## Tests

- Server: 504 of 504 pass.
- The fixed test passed three times in a row.
- With the new key set to `6700`, git 2.56's default, the test fails again with `3003 !== 0`, so the pinned threshold is what makes it pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
