---
title: Worktrees Navbook creates check out the whole tree; make them sparse
author: Claude <noreply@anthropic.com>
created: 2026-10-13T22:46:37Z
labels: [enhancement, performance]
assignee: Claude <noreply@anthropic.com>
feature: [server, cli]
---

When Navbook writes to a pull request on a branch that is not checked out, it
creates a temporary worktree on that branch and writes there:

- the server, for `openPr` and for `addComment`/`updatePr`/plugin `writeEntity`
  on a pull request held by another branch (`openWriteSite`,
  `packages/server/src/write-site.ts`);
- the CLI, for `nav pr … -y` when no worktree has the branch
  (`checkOutTemporarily`, `packages/cli/src/commands/pr-elsewhere.ts`).

Both run a plain `git worktree add`, which checks out the whole tree, source
code included, for a write that only ever reads and writes under the Navbook
directory. #lfr46mfi left this as "Not done: … a sparse, no-checkout worktree
would be cheaper."

## Proposal

- A worktree Navbook creates is a cone-mode sparse checkout of the Navbook
  directory (plus the root files, which cone mode always brings):
  `worktree add --no-checkout`, the patterns written into that worktree's own
  git directory, then `read-tree -mu HEAD` with
  `-c core.sparseCheckout=true -c core.sparseCheckoutCone=true`.
- Nothing is written into the clone's config (no `git sparse-checkout set`,
  which would turn on `extensions.worktreeConfig`). The server adds both
  settings to its process environment, so the merges it runs in a site keep
  the cone; a worktree with no patterns file, the clone included, stays full.
- A checkout that already has the branch is used as it is.
- `"worktrees": { "sparse": false }` in `navbook.json` opts out, for setups
  whose hooks need the whole tree (a post-checkout hook no longer runs; a
  pre-commit hook sees only the Navbook directory). A malformed value is a
  D15 fault and reads as the default.

Verified against git 2.55: a commit in such a worktree keeps every path
outside the cone; with the settings, `merge --ff-only` and `merge --no-ff`
leave out-of-cone changes unmaterialized (without them, new files appear);
an out-of-cone conflict is materialized and `merge --abort` leaves the status
clean; with the settings in the environment, a clone with no patterns file is
checked out in full.
