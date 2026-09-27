---
title: Offer to write a pull request in the worktree that already has its branch
author: Claude <noreply@anthropic.com>
created: 2026-09-18T11:29:06Z
target: dev
source: feat/tvxw30h3-worktree-offer
feature: [cli, pull-requests]
revisions:
  - head: f46c181ab7105390d78a6c85a54711388e7a0971
    base: 1e09e0f5b0f989481daca38885266fdec800c6bc
    date: 2026-09-18T11:29:06Z
  - head: 7ab9a66a9290254ab6e829ab0dd24c8101d3522a
    base: 2ec89b00f9543c784d202c11f09a60eb63e2ef9a
    date: 2026-09-27T00:36:43Z
  - head: dac0b0657f70bc108ccbc726e469de94abb86d9e
    base: 2ec89b00f9543c784d202c11f09a60eb63e2ef9a
    date: 2026-09-27T00:38:20Z
  - head: 0725d61c9f452b6f9de5dfc39e085a6ed3ea34b0
    base: b93ca766fdce43cdfdc79f85ce396abc6a3d49d9
    date: 2026-09-27T01:16:40Z
reviewer: Morgan PEYRE <morgan.peyre@brickcode.tech>
---

Closes #tvxw30h3.

A pull request is written on its source branch, so the five verbs that write into its directory — `edit`, `comment`, `update`, `request`, `review` — refuse from any other checkout. The refusal already names the branch and the worktree that has it. Everything needed to perform the write is known at that moment, so when there is somebody at a terminal and that worktree is clean, this asks instead of only pointing.

```console
$ nav pr comment na3o -m "Looks right to me."
#na3o4794 is on 'fix/d9ffyep0-marker-version', checked out in /home/deck/.cache/navbook-worktrees/d9ffyep0 (clean)
Write it there? [y/N] y
Commented on #na3o4794  .navbook/prs/open/na3o4794-.../comments/2026-09-18T...md  (#...)
written in /home/deck/.cache/navbook-worktrees/d9ffyep0
```

## No subshell, and no `cd`

The request mentioned a subshell to avoid moving the caller's working directory. Nothing needs spawning: a child process cannot change its parent shell's directory in any case. A second `Ctx` rooted at the other worktree is the whole mechanism, and each verb runs against it unchanged. Confirmed on a fixture: the calling checkout ends the command with no new commit, nothing staged, and its `HEAD` where it was.

## Where the offer lives

`findPrToWrite` is in `core`, which knows nothing about terminals and must keep knowing nothing — the server calls it and has nobody to ask. It is split in two:

- `locatePrToWrite` returns `{ entity, elsewhere }`, where `elsewhere` carries the ref, the branch, the worktree holding it and whether that worktree is clean.
- `findPrToWrite` keeps its signature and formats the same refusal from those facts.

The server's path is unchanged. The CLI's new `commands/pr-elsewhere.ts` consults the facts, asks, and retargets.

## Clean means tracked-clean

`isTreeClean` runs `git status --porcelain`, which counts untracked files. Reusing it would have made the feature fire almost never — the ordinary worktree in this repository has an untracked `node_modules`, and the real `#na3o4794` case was exactly that. What matters for this write is the index and the tracked tree: the write stages its own paths and nothing else, and `--commit` refuses over unrelated staged paths.

So `isTrackedTreeClean` is a new, separate predicate using `--untracked-files=no`. The two existing `isTreeClean` callers — `nav pr merge` and the server's start-up check — keep the strict reading, which is right for moving a ref or starting on a clone.

## Never assumed

A run with nobody to ask keeps the exit 1 it has always had. A pipeline that silently began writing into a checkout the user never named would be a worse outcome than a refusal, and every existing scripted caller keeps its behaviour. `-y`/`--yes` accepts the offer in advance, on all five verbs — whichever offer it is, an existing clean worktree or a temporary one. It is the same flag `nav pr merge` and `nav install` use to answer their question in advance, and it is what makes the behaviour testable without a pty. (Revisions 1 to 3 had a separate `--in-worktree` flag instead; revision 4 removed it.)

The flag is a pull-request notion, so it is not added to `issue edit` / `issue comment`: an issue lives on whatever branch you are standing on, and there is never another worktree to send its write to.

The refusal now says when a worktree was passed over for being unclean, so the absence of an offer is not a silence:

```
'feat/auth' is checked out in /tmp/.../wt (which has uncommitted changes); run the command there
```

## `pr update` gets more correct, not just more convenient

`update` pins the HEAD of wherever it runs. Moving it to the worktree that has the source branch pins the head actually under review — this checkout's `HEAD` was never a sensible thing to record, which is why the verb refuses here at all. Covered by a test that asserts the recorded head is the branch's.

## When no worktree has the branch

Added in revision 2. When the source is a local branch that no worktree has checked out, the same five verbs offer to check it out into a temporary worktree:

```console
$ nav pr comment <id> --commit -m "Read."
#<id> is on 'feat/auth', which no worktree has checked out
Check it out in a temporary worktree and write it there? [y/N] y
Commented on #<id>  .navbook/prs/open/<id>-feat-auth/comments/...md  (#...)
Committed docs(pr): comment on #<id>
written in a temporary worktree on 'feat/auth', since removed
```

- The directory comes from `mkdtemp` under `os.tmpdir()`, so `TMPDIR` decides where it goes and two runs never collide.
- It is removed once it holds nothing you would lose: after `--commit`, after a no-op, or when the command failed partway (a refused request, an editor that exits non-zero). The teardown runs in a `finally`.
- Without `--commit`, the write is staged in that worktree and nowhere else, so the worktree is kept and the run prints its path and the `git worktree remove` to run once you have committed.
- A branch that only a remote-tracking ref carries is not checked out this way, because that would create a local branch.

`prWriteSite` became `withPrWriteSite(ctx, prefix, opts, write)`, since the temporary checkout has a lifecycle around the write. `nav pr review` now checks its flags before resolving anything.

The earlier test "has nowhere to offer when no worktree holds the branch" asserted the old refusal and has been replaced by four cases: removed after commit, kept when only staged, removed on failure, and not used for a remote-only branch.

This revision also merges `dev` (0.4.0). The conflicts were import lists and one README table row, and both sides are kept. Suites: cli 354, core 748, server 344, conformance 117, deploy 59, all passing.

## Tests

Five new cases in `packages/cli/test/cli/pr.test.ts`: the write landing on the source branch with the calling checkout untouched; `update` pinning the source branch's head; the dirty-worktree refusal and its wording; untracked files not disqualifying a worktree; and no worktree at all falling back to `git switch`. The existing test at `pr.test.ts:986`, which asserts today's refusal under `spawnSync` pipes, passes unchanged — that is the non-interactive path.

Full suite, all green:

| suite | result |
|---|---|
| `packages/cli` | 104 passed (99 before) |
| `packages/core` | 718 passed |
| `packages/server` | 344 passed |
| `packages/web` unit | 373 passed |
| conformance | 115 passed |
| deploy | 59 passed |

`biome check` and `tsc --noEmit` clean across cli, core and server.

## Spec and README

[spec 04 §4.2](doc/spec/04-cli.md) gains a MAY for the five verbs, stating the conditions, that it is never assumed, that untracked files do not count, and that a run with nobody to ask MUST still refuse. The README command table gains a row.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
