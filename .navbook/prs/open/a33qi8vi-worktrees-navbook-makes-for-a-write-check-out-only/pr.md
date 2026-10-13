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
  - head: 7d9691ca4b4ca3ee439b6c03b05744c9355b82fc
    base: 15aa21593a12434e81c9e42685d772a0b474d1a7
    date: 2026-10-13T23:46:50Z
---

Closes #h45qu2fx.

A write to a pull request on a branch nobody has checked out happens in a temporary worktree on that branch: the server's write site, and the CLI's `-y` worktree. Both used to check out the whole branch, source code included, for a write that only reads and writes under the Navbook directory. They now check out that directory alone, plus the files at the top of the tree.

## What changes

- **Core: `addWriteWorktree(ws, path, branch, report)`** is the one entry point both front ends call.
  - Sparse: `worktree add --no-checkout`, cone patterns written into that worktree's own git directory (`gitPath`, which resolves `--git-path` without git 2.31's `--path-format`), then `read-tree -mu HEAD` with `SPARSE_CHECKOUT_ARGS` (`-c core.sparseCheckout=true -c core.sparseCheckoutCone=true`).
  - Nothing is written to the clone's config. `git sparse-checkout set` would have turned on `extensions.worktreeConfig`.
  - The cone also holds the hooks directory when `core.hooksPath` points inside the tree, as husky's `.husky/_` does. Without it git would silently run no hook there.
  - It falls back to a full checkout when the marker says `"worktrees": { "sparse": false }`, or when a directory can't be written as a cone pattern (glob characters, trailing blanks).
  - If filling the worktree fails, the worktree is removed. If git won't remove it, its directory is deleted and the registration pruned.
- **Server:**
  - `openWriteSite` uses it, and marks the site `sparse`.
  - `RepoSync`'s site merge passes `{ sparse }` to the fast-forward, merge and abort it runs there, so nothing outside the cone is written out. No other git command gets the settings, so there's no process-wide env.
  - A malformed policy is logged whenever the set of faults changes.
- **CLI:** `checkOutTemporarily` uses it. When it keeps a worktree (the change is staged but not committed), its note now says only the tracker is checked out there and names the opt-out.
- **Marker:**
  - `worktrees.sparse` is a fifth key in spec 02 §2.10. It's parsed like the merge policy, and a malformed value is reported under D15 and read as the default.
  - It is read from the checkout doing the write: the served clone for the server, the user's checkout for the CLI.
  - An existing checkout of the branch is used as it is.
- **Docs:** spec 02 §2.10, the spec 04 D15 row, spec 06 §6.3, `doc/plugins.md` (a `writeEntity` callback runs in such a worktree), the root and server READMEs, `.navbook/specs/server/api.md`. Two new conformance fixtures.

## Behaviour checked against git

- A commit in a sparse worktree keeps every out-of-cone path, even when made by hand with no settings.
- With the settings, `merge --ff-only` and `merge --no-ff` don't materialize out-of-cone changes. Without them, new files appear.
- An out-of-cone conflict is materialized, and `merge --abort` leaves the status clean. The site is removed afterwards anyway.

## Self-review (2026-10-14)

`/code-review high` found these, all now fixed:

- **Git 2.31 required.** `--path-format=absolute` is a 2.31 flag, which the project deliberately avoids (`leftovers.ts`). On older git it would have written a junk directory named after the flag and reported a sparse checkout that wasn't one. Replaced by `gitPath`, which `hooksDir` now shares.
- **Process-wide env.** The first version put the settings in the server's environment from `main.ts`. That had three problems:
  - It ran git on the repository path before the server had validated it, so a missing path reported "git was not found on PATH".
  - An embedded server (without `main.ts`) merged unsparse.
  - The clone's own patterns file was checked only at startup.

  The settings are now given per command, only in a sparse site.
- **Hooks skipped.** A relative `core.hooksPath` (husky) wasn't checked out, so hooks silently didn't run.
- **Dangling registration.** A worktree git wouldn't remove after a failed populate stayed registered with its directory gone.
- **Wording.** The CLI note misdescribed a nested Navbook directory's worktree.
- **Logging.** A policy fault fixed and broken again was never logged again.

Not changed: `WorktreePolicyReading.declared` is unused for now. It is kept so the reading has the same shape as the review and merge policies'.

## Heads-up for reviewers

- Hooks see only the tracker (plus their own directory) in these worktrees, and `post-checkout` no longer runs there. That's what the opt-out is for.

## Tests

| Suite | Result |
|---|---|
| core | 983 passed |
| server | 503 passed, 1 failed (see below) |
| cli | 440 passed |
| plugin-tests | 120 passed |
| conformance | 130 passed |

- Core: `worktree.test.ts` covers:
  - cone patterns, for one directory and several;
  - a nested Navbook directory;
  - commits keeping out-of-cone paths;
  - a merge under the settings;
  - config left untouched;
  - patterns removed with the worktree;
  - populate failure cleaned up, including when git won't remove the worktree (git shim);
  - a hooks directory inside and outside the tree;
  - the opt-out, and an unnameable directory.

  Plus policy and D15 cases.
- Server:
  - The fixture seed gained `src/deep/code.ts`.
  - `write-site.test.ts` covers a sparse site, the opt-out without a restart, and a malformed policy.
  - `pr-open.test.ts` covers an open, a merge of out-of-cone work on both sides, and an out-of-cone conflict. A pre-commit hook records what each commit saw, so every check also covers the merge commit.
- CLI: a committed `-y` write, a kept worktree finished with plain `git commit`, and the opt-out.
- The new tests fail against the old code. Mutation checks were also run for the per-command merge settings, the prune, and the hooks directory.

The server failure is `maintenance.test.ts` "packs what it finds, in the foreground" (3003 loose objects left where 0 are expected). It fails the same way on `dev`, and appeared when this machine's git became 2.56.0. It is not touched here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
