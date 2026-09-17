---
title: Find, show and act on pull requests that live on other branches
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-13T22:30:53Z
target: dev
source: fix/pr-all-refs-stale-ids
labels: [bug]
feature: [pull-requests, cli, server]
revisions:
  - head: 512f9f7c051168a7c1d37b5a4231c335f25a97a5
    base: 46501d696f5d1af53f8bf67626c373ee136d12a2
    date: 2026-09-13T22:30:53Z
  - head: 87fa168c7087ed4dd86efc2efa90bc17b10349a6
    base: 46501d696f5d1af53f8bf67626c373ee136d12a2
    date: 2026-09-14T06:15:48Z
  - head: 2d247259d7b18fdbdab6c1e8a8a3f5047f4bdf8a
    base: 46501d696f5d1af53f8bf67626c373ee136d12a2
    date: 2026-09-16T22:29:33Z
reviewer: copilot@github.com
---

Makes pull requests on other branches both visible and usable from any checkout, the case that matters when every branch sits in its own worktree. It fixes #t4mwvm2j, where an agent could find its assigned PR with `nav pr list --all-refs` but not show or review it using any ID the listing printed.

## Commits

Each commit passes lint, typecheck, the core/cli/server builds and the core, cli and server test suites on its own.

1. **feat(core): resolve many ref paths in one cat-file.** `batchResolve` and `lsTreeNamesOfTree`, the plumbing the next two commits use.
2. **feat(cli): point an empty pr list at --all-refs.** When `nav pr list` matches nothing here but other branches carry open PRs, it prints the count and the flag on stderr. Stdout and `--json` are unchanged.
3. **fix(core): leave merged and closed pull requests out of --all-refs.** A source branch left behind after its merge still carries the `prs/open/` copy. The listing now asks the PR's target branch and the default branch whether it is settled, and the hint's count does the same. `scanRefsForOpenPrs` stays unfiltered, so merging still sees stale copies.
4. **feat(core): accept #id and entity paths as ID arguments.** `'#sf9fu6z4'` and the `path` from `--json` now resolve wherever an ID does.
5. **fix(pr): resolve a pull request that another branch holds.**
   - `nav pr show` falls back to the branch that carries the PR. It names that branch on stderr and adds `refs` to `--json`.
   - `review`, `comment`, `edit`, `update` and `request` refuse with exit 1 and say where to run instead: the branch, the worktree that has it checked out, or `git switch <branch>` for a remote-only copy.
   - "No pull request matches" is now reserved for an ID that no fetched branch carries.
6. **refactor(server): read a pull request through core's readPr.** The GraphQL `pr` query had its own copy of that fallback.

Revision 3 also includes the review fixes: `--commit` now refuses on a detached HEAD (#mdftn010), and the hint's count skips the same pull requests `--all-refs` leaves out.

The integration guide that revisions 1 and 2 carried as their first commit is now its own pull request, on `docs/integration-guide`. Revision 3 is revision 2 without it, so the code has not changed. Once both are merged, the guide's section on branch scope should mention the stderr hint from commit 2.

## Worth a look

- **Writes are refused, not written onto the other branch.** This matches the server's `writeTarget`. Committing to a branch without checking it out would need new plumbing, and it is unsafe when another worktree has that branch checked out, possibly with uncommitted changes. If we want that, it should be a separate change.
- **Stale copies.** If a PR's target has merged it but its source branch still holds the open copy, `show` from a third branch displays that stale copy as open, and the write refusal points at that branch. Commit 3 fixes this for the listing only.
- Commit 4 has no tests of its own. The `#<id>` and path forms are covered by the tests in commit 5.

## Verifying

```sh
pnpm check
pnpm --filter @navbook/cli test     # "a pull request that only another branch holds", "--all-refs" suites
pnpm --filter @navbook/core test && pnpm --filter @navbook/server test && pnpm test:conformance
```

Against the published `nav` 0.2.0 (`NAV_BIN=$(which nav)`), 7 of the 8 new cross-branch tests fail.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
