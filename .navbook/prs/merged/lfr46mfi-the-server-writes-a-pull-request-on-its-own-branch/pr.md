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
  - head: fa12d443964196b41c30c00729fc856f2bb820e7
    base: 8fdb571322ac2d6cebc3adff32468e04eabbc08b
    date: 2026-10-05T00:57:25Z
merged:
  date: 2026-10-05T00:58:02Z
  by: Claude <noreply@anthropic.com>
---

Closes #yp56dc43, the first of three steps towards #c43a2w7e (plugin-chat).

A pull request's files live on the branch it proposes to merge (spec 03 §3.5), which the serving checkout usually does not hold. The server used to refuse to comment on or patch such a pull request, and could not open one. It now writes where a person at a terminal would: in a worktree on that branch.

## What changes

- **`RepoSync.writeOn`** runs the write transaction on a site chosen under the lock, after the fetch.
  - It merges the site with its remote-tracking branch (fast-forward, merge, or `SYNC_CONFLICT` with an abort), runs the body, then pushes *that* branch with the same one-retry rule.
  - `close` is always called with the outcome.
  - `write` is now a thin wrapper over it.
- **`write-site.ts`**:
  - The site is a temporary worktree (`nav-server-wt-*` under the OS temp dir) on the server's own copy of the branch, `nav-server/<branch>`, made from `origin/<branch>` and pushed to `<branch>`. The clone's own local branches are never written on, pushed or deleted: they are an operator's.
  - The copy is deleted once the remote has everything on it, and kept (and logged) while it carries an unpushed commit, exactly as the served branch keeps a stopped push. It is deleted only after its worktree is gone.
  - The push is leased on the remote tip the write merged, so a branch deleted meanwhile is refused (`PRECONDITION`) rather than created again.
  - A registration whose directory is gone is pruned; one of the server's own temporary worktrees left behind is taken over; a worktree somebody else made is refused.
  - Leftovers from a killed server are swept at startup.
- **`openPr(input: OpenPrInput!)`** opens a pull request on a branch already on the remote.
  - `source` and `target` must be names git takes for a branch (`INVALID_INPUT` otherwise: no `--octopus`, `HEAD~3`, `feat~1`), and the target must be a branch on the remote, read from `origin/<target>` rather than a local branch that may be stale (core `preparePrOpen` gained `source`, `sourceRev` and `targetRev`).
  - The served branch and the default branch are refused as a source.
  - A branch with no `.navbook/` is refused plainly.
- **`addComment` / `updatePr`** on a pull request held by another branch now write on the branch its `source:` names, and report `refs: [<branch>]`. A branch that merged the source in carries the pull request's directory too, and is never written instead: when the source branch no longer carries it, the write is refused.
  - The remaining refusal is `PRECONDITION` with `extensions.branch`, which the web alert now reads; its copy no longer tells anyone to serve another branch.
- **Docs**: spec 06 (now "most checkout-centric verbs are not exposed", plus a paragraph on writing on the branch), `.navbook/specs/server/api.md`, `.navbook/specs/pull-requests/lifecycle.md`, and the server README.

## Self-review (2026-10-05)

Rebased onto `dev`, which had gained plugin-tests and its `host.api.writeTarget`; that is kept, beside this branch's `writeEntity`. An adversarial review then found, and this branch now fixes:

- **Writes on the wrong branch.** `sourceOf` compared `origin/<b>` with the PR's `source:` and never matched, so the alphabetically first branch carrying the PR's directory won — any branch that had merged the source. Writes now go to the `source:` branch only.
- **Any target.** `openPr` passed `target` to `git merge-base` unchecked (`--octopus` was recorded), and read a stale local branch over the remote's.
- **The operator's branches.** The site deleted a local branch it had not made, and would have pushed an operator's unpushed commits on it: hence the `nav-server/` copies.
- **Who may push where.** Opening a PR from the default or served branch is refused.
- **Clean-up.** A branch was deleted under a worktree that could not be removed, leaving every later write refused; the sweep logged removals that failed.
- **A branch made again.** A plain push recreated a branch deleted after the fetch; the push is now leased.
- **Codegen.** The web client's generated types had not been regenerated after the schema's doc changes.

Not done: each off-branch write checks out the whole tree; a sparse, no-checkout worktree would be cheaper.

## Tests

| Suite | Result |
|---|---|
| core | 953 passed |
| server | 487 passed |
| cli | 426 passed |
| plugin-tests | 120 passed |
| conformance | 128 passed |
| Playwright | 196 passed (on the combined stack with #kw6afa4a and #s86nic83) |

- New `branches.test.ts` and `preparePrOpen` cases (explicit source, detached HEAD, not-a-branch, self-target, orphan, `targetRev`).
- 11 `RepoSync.writeOn` unit cases (site merge, clone site, throw, open failure, no-op, conflict, retry into the site, kept commit, no remote, events).
- `pr-open.test.ts` (24 cases), including the diverged/conflicting local copies and 5 concurrent opens.
- `pr.test.ts`'s two refusal tests flipped to writes that land on `fix-login`.
- The e2e refusal cases now force the refusal with `page.route` (`only`/`refusal` moved into the shared fixtures), and two new specs prove a comment and a reviewer change land on `feat/unserved`.

Two timing tests failed once each under a load average of 25 and pass alone, on this branch and on dev: the TreeCache watchdog, and the CLI "1000 issues" budget.

## Heads-up

`host.api.writeTarget` stays as #z9yqtsbv made it, refusing a pull request the served checkout does not hold; #kw6afa4a adds `host.api.writeEntity` beside it for a plugin that wants to write there.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
