---
title: The server writes a pull request on its own branch, and opens pull requests
author: Claude <noreply@anthropic.com>
created: 2026-09-29T02:09:20Z
target: dev
source: feat/yp56dc43-server-pr-write-site
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: e24837941a2e1ab4f9f9ba15c4b27d743011029f
    base: d576c77713d71b04f266bde7b9b50718df4af151
    date: 2026-09-29T02:09:20Z
  - head: 68228098b310b16034084a9a47af279eb33e1887
    base: 71a0111d4a058212fe8e75b0c6fa2e1f41b103fc
    date: 2026-09-30T14:11:31Z
---

Closes #yp56dc43, the first of three steps towards #c43a2w7e (plugin-chat).

A pull request's files live on the branch it proposes to merge (spec 03 §3.5), which the serving checkout usually does not hold. The server used to refuse to comment on or patch such a pull request, and could not open one. It now writes where a person at a terminal would: in a worktree on that branch.

## What changes

- **`RepoSync.writeOn`** runs the write transaction on a site chosen under the lock, after the fetch.
  - It merges the site with its remote-tracking branch (fast-forward, merge, or `SYNC_CONFLICT` with an abort), runs the body, then pushes *that* branch with the same one-retry rule.
  - `close` is always called with the outcome.
  - `write` is now a thin wrapper over it.
- **`write-site.ts`**:
  - The site is a temporary worktree (`nav-server-wt-*` under the OS temp dir) on a local copy of `origin/<branch>`.
  - The copy is deleted once it equals the remote, and kept (and logged) while it carries an unpushed commit, exactly as the served branch keeps a stopped push.
  - A registration whose directory is gone is pruned.
  - A worktree somebody else made is refused.
  - Leftovers from a killed server are swept at startup.
- **`openPr(input: OpenPrInput!)`** opens a pull request on a branch already on the remote.
  - A target known only as `origin/<target>` is read from there (core `preparePrOpen` gained `source` and `targetRev`).
  - A branch with no `.navbook/` is refused plainly.
- **`addComment` / `updatePr`** on a pull request held by another branch now write on that branch and report `refs: [<branch>]`.
  - The remaining refusal is `PRECONDITION` with `extensions.branch`, which the web alert now reads; its copy no longer tells anyone to serve another branch.
- **Docs**: spec 06 (now "most checkout-centric verbs are not exposed", plus a paragraph on writing on the branch), `.navbook/specs/server/api.md`, `.navbook/specs/pull-requests/lifecycle.md`, and the server README.

## Tests

| Suite | Result |
|---|---|
| core | 896 passed |
| server | 461 passed |
| cli | 401 passed |
| plugin-kb | 138 passed |
| conformance | 128 passed |
| deploy | 73 passed |
| web vitest | 410 passed |
| Playwright | 171 passed |

- New `branches.test.ts` and `preparePrOpen` cases (explicit source, detached HEAD, not-a-branch, self-target, orphan, `targetRev`).
- 11 `RepoSync.writeOn` unit cases (site merge, clone site, throw, open failure, no-op, conflict, retry into the site, kept commit, no remote, events).
- `pr-open.test.ts` (24 cases), including the diverged/conflicting local copies and 5 concurrent opens.
- `pr.test.ts`'s two refusal tests flipped to writes that land on `fix-login`.
- The e2e refusal cases now force the refusal with `page.route` (`only`/`refusal` moved into the shared fixtures), and two new specs prove a comment and a reviewer change land on `feat/unserved`.

Two timing tests failed once each under a load average of 25 and pass alone, on this branch and on dev: the TreeCache watchdog, and the CLI "1000 issues" budget.

## Heads-up

#z9yqtsbv exports `writeTarget` for plugins. It is gone here, and #kw6afa4a will expose `writeEntity` as `host.api.writeEntity` instead (see the comments on #yp56dc43).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
