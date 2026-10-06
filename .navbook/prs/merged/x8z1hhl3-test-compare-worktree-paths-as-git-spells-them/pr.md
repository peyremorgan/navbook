---
title: "test: compare worktree paths as git spells them"
author: Claude <noreply@anthropic.com>
created: 2026-10-06T22:47:05Z
target: dev
source: fix/tests-tmp-realpath
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: d6d6dfa5315318051611f2f268bee0eb28cd229e
    base: e928d0a477ac9e3d9407176e32e5377024a249fa
    date: 2026-10-06T22:47:05Z
merged:
  date: 2026-10-06T22:52:09Z
  by: Claude <noreply@anthropic.com>
  commit: 51292bf9b8f4c2d16fdf98ce00249a050d34cdb8
---

The server and CLI suites now pass on macOS, apart from one maintenance test that depends on the git version (below).

## Why

git names a worktree by its resolved path. On macOS the temporary directory is reached through a symlink (`/var` → `/private/var`), so every test that compared `git worktree list` with a `tmpdir()` path failed there: 30 in `@navbook/server` and 1 in `@navbook/cli`. All were added after v0.5.0. CI runs only on `main`, so none of them has run on its macOS runners yet. The 0.6.0 release would have turned those jobs red.

The production code is not affected: `write-site.ts` compares both spellings (`listed === path || listed === real`), and `leftovers.ts` resolves both sides.

## Change

- `worktrees()` in `packages/server/test/helpers/temprepo.ts` resolves what git lists. A new `real()` resolves the expected side at the 13 call sites in `pr-open`, `pr` and `write-site`.
- `real()` resolves the nearest existing ancestor when the path is gone. A locked worktree makes `closeWriteSite` delete the directory while git keeps listing it, so `realpathSync` alone would hand back the `/var` spelling.
- The server is still handed the unresolved path, as it is in production, so the tests keep covering the symlinked case on macOS. Resolving the fixture's root instead would have lost that.
- The CLI case (`nav pr open --source` › "writes in the clean worktree that already has the branch") now builds its pattern as the `pr comment` case further down the same file does: resolved, with `/`, and fully escaped. It escaped only `/` before, so it would also have failed under Windows.

## Tests

- `@navbook/cli`: 437/437.
- `@navbook/server`: 491 pass, 1 skipped (as before), 1 fail. The failure is `maintenance.test.ts` › "packs what it finds…": Apple Git 2.50.1's `maintenance run --auto` falls back to `gc --auto`, which needs about 6,700 loose objects, and the test makes 3,000. It passed on CI's Linux runners for 0.5.0, and this change does not touch it.
- Typecheck and Biome are clean.
- On Linux `real()` is the identity, so nothing changes there.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
