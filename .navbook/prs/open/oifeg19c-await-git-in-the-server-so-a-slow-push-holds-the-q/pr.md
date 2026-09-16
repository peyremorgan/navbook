---
title: Await git in the server, so a slow push holds the queue and nothing else
author: Claude <noreply@anthropic.com>
created: 2026-09-16T07:38:55Z
target: dev
source: feat/async-git-layer
reviewer: morgan.peyre@brickcode.tech
labels: [enhancement]
feature: [server, gateway]
revisions:
  - head: a69de42be11a9dd889ffccabc074cd55bf337203
    base: 4be9a430f8bfc25f1b8a63f2eacebbbdbc1129aa
    date: 2026-09-16T07:38:55Z
---

Fixes #i3fyesqd.

`nav-server` ran every git command through `spawnSync`, so while one person's push was in flight the process could not serve the GraphiQL page, refuse a bad token or answer a health probe. This makes the sync engine await its git calls under the lock it already had, and bounds the calls that reach the network.

## What changed

- **Core** — `packages/core/src/git/exec.ts` gains `gitRunAsync`, `gitAsync` and `gitMaybeAsync` beside the blocking runner, with a `timeoutMs` that stops the child and rejects with a new `GitTimeoutError`. The eleven operations `RepoSync` names have `…Async` twins that share their arguments and their reading of git's output with the blocking forms, so the two cannot drift. Nothing the CLI calls changed.
- **Server** — `SyncGit` is promise-returning, `pull`/`merge`/`pushWithRetry` are `async`, `Mutex.run` is untouched, and operation bodies stay synchronous. A stopped fetch or push goes to the log and to the client as `SYNC_FAILED`, with `keptLocalCommit` saying whether a commit was left behind; the next push carries it, so there is nothing for an operator to reconcile.
- **`--git-timeout-ms` / `NAV_SERVER_GIT_TIMEOUT_MS`** — default 30000, 0 for as long as git allows. In the README table, `.env.example`, `compose.yaml` and the deploy test's list of documented names.
- The `Mutex` header, the concurrency suite's header and the README's "two limits" paragraph all said git was synchronous. They now say what is true.

## Numbers

An origin whose `pre-receive` sleeps 3 s, one mutation pushing, three requests fired together 400 ms in:

| request | before | after |
|---|---|---|
| GET /graphql (GraphiQL page) | 2798 ms | 5 ms |
| POST with no token (401) | 2801 ms | 7 ms |
| authenticated `{ issues }` | 2860 ms | 2870 ms |

The last row is by design: a read takes the lock and runs on the tree the mutation left.

## Tests

- `packages/core/test/git-async.test.ts` (new): the runner matches `gitRun` on exit code, output, input and the buffer limit; the timeout fires on a git that genuinely hangs (a credential helper that sleeps) and does not wait for the helper; the async twins answer what their blocking forms answer, including a real conflict.
- `packages/core/test/remote.test.ts`: async fetch and push; a push stopped by its timeout, after which the clone pushes again cleanly; a push that waits when given no timeout.
- `packages/server/test/unit/sync.test.ts`: the matrix on async fakes, plus a read queued behind a push still in flight, `drain()` waiting on that push, and the timeout branches.
- `packages/server/test/server/responsiveness.test.ts` (new): the table above as assertions; `--git-timeout-ms 500` against a 4 s push, checking the commit is kept, the tree is clean, the log line is there and the next push carries it; `SIGTERM` during a push, checking the push lands and the process exits 0.
- biome and `tsc` for every package, core (693), server (257) and deploy compose (11) suites pass.

## Worth a look

- A stopped command sends `SIGTERM` first, because git removes its lock files on the way out, and `SIGKILL` 2 s later for a git that did not take the hint.
- `gitRunAsync` settles a stopped command on `exit`, not `close`. A child of the stopped git (`receive-pack`, a credential helper) keeps the pipes open until it finishes, and waiting for that would be the wait the timeout exists to avoid; the stopped command's output is dropped.
- The tests' stalled origin is a `pre-receive` hook that sleeps. A stopped push leaves the origin's `receive-pack` sleeping in that hook; it finishes on its own clock and either lands the push or fails to lock the ref, and the assertions hold either way.
- The two timing assertions (`< 1500 ms` for requests that never touch the clone, against a 3 s stall) are the one place a very loaded machine could bite. They are generous by design, and a false pass is possible on a machine slow enough that the probes land before the push starts, but not a false failure short of the process itself stalling.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
