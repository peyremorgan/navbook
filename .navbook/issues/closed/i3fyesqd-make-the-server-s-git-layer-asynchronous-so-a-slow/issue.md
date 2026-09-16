---
title: Make the server's git layer asynchronous, so a slow fetch or push stops blocking every other request
author: Morgan PEYRE <morgan@peyre.info>
created: 2026-09-16T06:09:56Z
assignee: Claude <noreply@anthropic.com>
labels: [enhancement]
feature: [server, gateway]
parent: tn7ptt6k
resolution: fixed
---

`nav-server` runs every git command through `spawnSync`, so a fetch, a merge or a push occupies the event loop for its whole duration. One person's slow push is every other person's latency: the process cannot answer an unrelated read — or serve the GraphiQL page, or a health probe — until the network call returns. On a remote that is briefly unreachable, `git push` waits out its own timeout with the server wedged behind it.

`Mutex` in `src/lock.ts` already says this in its own header: it "guards less than it looks", because a synchronous operation runs to completion in one turn and could not be interleaved anyway, and what it is really for is "the day the git layer stops being synchronous, which is the fix for it blocking the event loop". This is that ticket.

The lock is the part that makes it tractable. Operations are already serialised through it and `drain()` already means something at shutdown, so making git asynchronous does not change the concurrency model — it makes the model that is already written down start doing work.

## What it should do

1. **An async git layer in core.** `packages/core/src/git/exec.ts` gains a promise-returning twin of its `spawnSync` runner, and the operations `RepoSync` names — `fetchRemote`, `pushBranch`, `mergeNoCommit`, `fastForward`, `commitMerge`, `abortMerge`, `conflictedPaths`, `resolveSha`, `isAlreadyMerged`, `canFastForward`, `currentBranch` — get async forms. The synchronous ones stay: the CLI is a process that runs one command and exits, and has nothing to gain from awaiting.
2. **`RepoSync` awaits them.** `SyncGit` becomes promise-returning, `pull`, `merge` and `pushWithRetry` become async, and `Mutex.run` keeps every operation ordered exactly as it orders them now. The lock stops being a promise about the future and becomes the thing that holds the tree still.
3. **The tree operations stay synchronous.** Composing a file, validating it and running a plan are local `readFileSync`/`writeFileSync` work measured in milliseconds; making them async would spread `await` through core's operations for no latency anybody can perceive. The win is entirely in the network calls, and the boundary belongs where the network is.
4. **Timeouts on the network calls.** With git awaited rather than blocking, a fetch or push that never returns should fail its own request rather than hold the lock forever: a `--git-timeout-ms` (`NAV_SERVER_GIT_TIMEOUT_MS`, defaulting to something like 30s) that kills the child and reports `SYNC_FAILED`. Today a hung push is indistinguishable from a wedged server, which is most of why this is worth doing.

## Edges

- `SyncGit` is already injectable and the sync tests drive it with fakes, so the matrix in `test/unit/sync.test.ts` carries over by making the fakes async. That suite is the proof that the ordering guarantees survive.
- A read under the lock still blocks other reads, because they share one working tree — that is by design and does not change. What changes is that the *process* stays responsive: health probes and the GraphiQL page are answered while a push is in flight.
- `Mutex.drain()` becomes load-bearing rather than nearly free, so shutdown wants a test that a `SIGTERM` during an in-flight push waits for it.
- Worth measuring before and after on a repository with a real remote, so the ticket closes on a number rather than an assertion.
