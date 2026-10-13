---
title: Worktrees Navbook makes for a write check out only the tracker
author: Claude <noreply@anthropic.com>
created: 2026-10-13T23:24:07Z
target: dev
source: feat/h45qu2fx-sparse-worktrees
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: b8cf1773169d6cbd1260b357ac05e984f1cbdf8c
    base: 15aa21593a12434e81c9e42685d772a0b474d1a7
    date: 2026-10-13T23:24:07Z
---

Closes #h45qu2fx.

A write to a pull request on a branch nobody has checked out happens in a temporary worktree on that branch: the server's write site, and the CLI's `-y` worktree. Both used to check out the whole branch, source code included, for a write that only reads and writes under the Navbook directory. They now check out that directory alone, plus the top-level files.

## What changes

- **Core: `addWriteWorktree(ws, path, branch, report)`** is the one entry point both front ends call.
  - Sparse: `worktree add --no-checkout`, cone patterns written into that worktree's own git directory, then `read-tree -mu HEAD` with `-c core.sparseCheckout=true -c core.sparseCheckoutCone=true`.
  - Nothing is written to the clone's config. `git sparse-checkout set` would have turned on `extensions.worktreeConfig`, against the rule in `git-env.ts`.
  - It falls back to a full checkout when the marker says `"worktrees": { "sparse": false }`, or when the Navbook directory's name can't be written as a cone pattern (glob characters, trailing blanks).
  - If filling the worktree fails, the worktree is removed again.
- **Server:**
  - `openWriteSite` uses it, and logs a malformed policy once per server.
  - `main.ts` adds both settings to the process env (`enableSparseWorktrees`), so the merges it runs in a site keep to the cone. Git applies patterns only in a worktree that has its own patterns file, so the clone stays whole. A clone that already has `.git/info/sparse-checkout` keeps its own settings, and the server says so at startup.
- **CLI:** `checkOutTemporarily` uses it. When it keeps a worktree (the change is staged but not committed), its note now says only the tracker is checked out there and names the opt-out.
- **Marker:**
  - `worktrees.sparse` is a fifth key in spec 02 §2.10. It's parsed like the merge policy, and a malformed value is reported under D15 and read as the default.
  - It is read from the checkout doing the write: the served clone for the server, the user's checkout for the CLI.
  - An existing checkout of the branch is used as it is.
- **Docs:** spec 02 §2.10, the spec 04 D15 row, spec 06 §6.3, `doc/plugins.md` (a `writeEntity` callback runs in such a worktree), the root and server READMEs, `.navbook/specs/server/api.md`. Two new conformance fixtures.

## Behaviour checked against git 2.55

- A commit in a sparse worktree keeps every out-of-cone path, even when made by hand with no settings.
- With the settings, `merge --ff-only` and `merge --no-ff` don't materialize out-of-cone changes. Without them, new files appear, which is why the server sets them process-wide. A test fails if `main.ts` doesn't call `enableSparseWorktrees`.
- An out-of-cone conflict is materialized, and `merge --abort` leaves the status clean. The site is removed afterwards anyway.
- With the settings in the env, a clone with no patterns file stays a full checkout.

## Heads-up for reviewers

- Hooks now see only the tracker in these worktrees, and `post-checkout` no longer runs there. That's what the opt-out is for.

## Tests

| Suite | Result |
|---|---|
| core | 917 passed, 1 skipped |
| server | 505 passed, 1 failed (see below) |
| cli | 440 passed |
| plugin-tests | 120 passed |
| conformance | 130 passed |

- Core: new `worktree.test.ts` (cone patterns, nested Navbook directory, commits keep out-of-cone paths, a merge under the settings, config untouched, patterns removed with the worktree, populate failure cleaned up via a git shim, the opt-out, an unnameable directory), plus policy and D15 cases.
- Server:
  - The fixture seed gained `src/deep/code.ts`.
  - `write-site.test.ts` covers a sparse site, the opt-out without a restart, and a malformed policy logged once.
  - `pr-open.test.ts` covers an open, a merge of out-of-cone work on both sides, and an out-of-cone conflict. A pre-commit hook records what each commit saw, so every check also covers the merge commit.
  - `git-env.test.ts` covers the stale-patterns guard.
- CLI: a committed `-y` write, a kept worktree finished with plain `git commit`, and the opt-out.
- The new server and CLI tests fail with this branch's `src/` stashed.

The server failure is `maintenance.test.ts` "packs what it finds, in the foreground": 3003 loose objects are left where 0 are expected. It fails the same way on `dev`. This machine's git was upgraded to 2.56.0 during the work, which is probably the cause. It is not touched here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
