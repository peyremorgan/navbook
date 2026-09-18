---
title: Offer to write to a pull request in the worktree that already has its branch
author: Claude <noreply@anthropic.com>
created: 2026-09-18T11:06:51Z
labels: [enhancement]
assignee: Claude <noreply@anthropic.com>
feature: [cli, pull-requests]
resolution: fixed
---

Writing to a pull request whose branch lives in another worktree refuses with exit 1 and tells you to go there yourself. When there is somebody at a terminal and that worktree is clean, `nav` already knows everything it needs to just do it — and should offer to.

## What happens now

Standing on `dev`, with `fix/d9ffyep0-marker-version` checked out in a second worktree that carries #na3o4794:

```console
$ nav pr comment na3o -m "Looks right to me."
nav: #na3o4794 is on 'fix/d9ffyep0-marker-version', which is not checked out here
a pull request is written on its source branch, beside the files it proposes to merge
'fix/d9ffyep0-marker-version' is checked out in /home/deck/.cache/navbook-worktrees/d9ffyep0; run the command there
```

The message is right and it names the worktree, which is what [#t4mwvm2j](../t4mwvm2j-pull-requests-found-by-list-all-refs-cannot-be-sho/issue.md) asked for. But the user now retypes the command with a `cd` in front of it, and the reviewing agent that hit this has to decide whether changing its shell's directory is safe. Every fact needed to perform the write is already in hand at the moment of the refusal: the branch, the worktree that holds it, and whether that worktree is clean.

## What it should do

When **all** of the following hold, ask instead of refusing:

- the run is interactive (`isInteractive` — both stdin and stdout are a TTY),
- the pull request is on a local branch, not a remote-tracking ref,
- another worktree has that branch checked out,
- that worktree is clean.

```console
$ nav pr comment na3o -m "Looks right to me."
#na3o4794 is on 'fix/d9ffyep0-marker-version', checked out in /home/deck/.cache/navbook-worktrees/d9ffyep0 (clean).
Write the comment there? [y/N] y
Commented on #na3o4794  .navbook/prs/open/na3o4794-.../comments/2026-09-18T...md  (#...)
```

Declining exits 1 with today's message, unchanged. Any condition unmet — piped, remote-tracking source, dirty worktree — is today's refusal, unchanged, with the dirty case saying so rather than staying silent about why it did not offer.

**No `cd`, and no subshell.** A child process cannot change its parent shell's working directory in any case, so nothing has to be spawned: `makeContext({ cwd: worktreePath })` returns a `Ctx` whose `repoRoot` is the other worktree ([context.ts:27](packages/cli/src/context.ts#L27), [ctx.ts:75](packages/core/src/workspace/ctx.ts#L75)), and the verb runs against that unchanged. The calling shell never moves.

## Which verbs

The five that write into the pull request's directory, per [spec 04 §4.2](doc/spec/04-cli.md): `edit`, `comment`, `update`, `request`, `review`. All five reach the refusal through one function, [`findPrToWrite`](packages/core/src/ops/pr.ts#L985), via [`writeTarget`](packages/cli/src/commands/entity.ts#L303) and [`cmdPrReview`](packages/cli/src/commands/pr.ts#L165).

Not `close` (it materializes the directory onto the current branch on purpose), not `delete` (spec 04: it MUST act on the checked-out tree alone), not `show` (already reads across refs).

## Where the offer belongs

`findPrToWrite` is in `core`, which knows nothing about terminals and must keep knowing nothing — the server calls the same function and has no one to ask. So `core` should expose the facts and `cli` should ask the question.

Concretely: give the refusal a machine-readable shape, or add a `locatePrForWrite`-style function returning `{ entity, sourceRef, sourceRemote, worktree, worktreeClean }` that `findPrToWrite` then formats its `wsFail` from. The CLI's `writeTarget` consults that, prompts, and retargets. The server keeps calling `findPrToWrite` and keeps getting the refusal.

## One trap, already confirmed

`isTreeClean` ([repo.ts:229](packages/core/src/git/repo.ts#L229)) runs `git status --porcelain`, which counts untracked files. Reusing it as the gate makes the feature fire almost never, because the ordinary worktree here has an untracked `node_modules`:

```console
$ cd /home/deck/.cache/navbook-worktrees/d9ffyep0
$ git status --porcelain
?? node_modules
$ git status --porcelain --untracked-files=no
$                                  # clean
```

What actually matters for this write is the index and the tracked tree, because the verb stages files into that worktree's index and `--commit` refuses over unrelated staged paths ([`assertNoUnrelatedStaged`](packages/core/src/workspace/commit-flow.ts#L28)). An untracked `node_modules` is irrelevant to both. So the gate wants `--untracked-files=no`, as a separate predicate from `isTreeClean` — the two existing callers (`nav pr merge`, the server's start-up check) want the strict reading and should keep it.

## Why clean at all

Without `--commit` the change is left staged, so an offer accepted against a dirty worktree would mix a tracker write into work in progress somewhere the user is not looking. With `--commit` it would hit `assertNoUnrelatedStaged` and fail after the fact. Refusing up front is the honest version of both.

## Tests

[`packages/cli/test/cli/pr.test.ts:986`](packages/cli/test/cli/pr.test.ts#L986) already builds the exact scenario — `git worktree add` plus a refused `nav pr review` — and asserts today's message. That test must keep passing: it runs under `spawnSync` with pipes, so it is non-interactive and takes the unchanged path. The new behaviour needs a test that supplies a TTY, or that the prompt is injectable.
