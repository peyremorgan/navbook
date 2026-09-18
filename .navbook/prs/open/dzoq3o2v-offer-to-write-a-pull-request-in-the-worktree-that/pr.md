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

A run with nobody to ask keeps the exit 1 it has always had. A pipeline that silently began writing into a checkout the user never named would be a worse outcome than a refusal, and every existing scripted caller keeps its behaviour. `--in-worktree` answers the question in advance, on all five verbs — and is what makes the behaviour testable without a pty, which is also how `nav install`'s prompt is covered.

The flag is a pull-request notion, so it is not added to `issue edit` / `issue comment`: an issue lives on whatever branch you are standing on, and there is never another worktree to send its write to.

The refusal now says when a worktree was passed over for being unclean, so the absence of an offer is not a silence:

```
'feat/auth' is checked out in /tmp/.../wt (which has uncommitted changes); run the command there
```

## `pr update` gets more correct, not just more convenient

`update` pins the HEAD of wherever it runs. Moving it to the worktree that has the source branch pins the head actually under review — this checkout's `HEAD` was never a sensible thing to record, which is why the verb refuses here at all. Covered by a test that asserts the recorded head is the branch's.

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
