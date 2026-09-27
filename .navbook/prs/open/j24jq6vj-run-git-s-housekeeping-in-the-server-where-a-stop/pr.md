---
title: Run git's housekeeping in the server, where a stop can wait for it
author: Claude <noreply@anthropic.com>
created: 2026-09-27T21:51:42Z
target: dev
source: fix/cvb57nhm-server-owned-maintenance
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
revisions:
  - head: 59046cf7bf2384ef1852ef146fc0b218eb8bf0aa
    base: 6c48ca18421ac3f61539e6c7edc29c0db8cf2cc2
    date: 2026-09-27T21:51:42Z
  - head: dae74f8a7d4b50d98598dbbab157e9f3ceecee51
    base: ae9aac59e6675b95dadf50874ea94b50cf5a5a6a
    date: 2026-09-27T22:23:56Z
---

Fixes #cvb57nhm. The server's own `git commit`, `fetch` and `merge` start `git maintenance run --auto --detach`, which runs in a session of its own. No drain waits for it, and no signal the server gets reaches it. So `docker stop` SIGKILLs it partway through, and what it leaves stays in the volume. A stale `packed-refs.lock` fails every `fetch --prune` once a branch is deleted on origin, and with it every request (reproduced; see the issue).

## What changes

- **Git no longer starts maintenance on its own.**
  - `main.ts` appends `maintenance.auto=false` to the `GIT_CONFIG_*` of every git the server runs. `git-env.ts` reads an existing count exactly as git's `strtoul` does. The CLI is untouched.
  - The entrypoint sets it too, for its seeding fetch.
- **The server runs maintenance itself** (`maintenance.ts`).
  - It runs `git -c gc.autoDetach=false maintenance run --auto --quiet` in the foreground, in a process group of its own.
  - A run starts after any fetch that succeeded or a write that committed, at most once per `--maintenance-interval-ms` (default 300000). The interval is timed on a monotonic clock.
  - Runs go beside requests, not in front of them.
  - `0` turns it off, with a startup warning.
- **Shutdown** gives a run 5 s. Then it stops the whole group: SIGTERM, which lets git remove its locks, then SIGKILL after 2 s.
  - `gitRunAsync` gains `signal` and `processGroup` for this. A grouped command settles only once its group is empty.
  - A run past 30 minutes is stopped the same way, and its temporary files are removed under `RepoSync.exclusive`, when no fetch can be writing one.
- **At startup** (`leftovers.ts`), the server removes what an interrupted run left (a SIGKILL, an OOM kill), naming each file in the log:
  - maintenance and ref-packing locks, and their `tmp_*` / `.tmp-*` / `bitmap-ref-tips_*` files, older than the start;
  - but only warns if a git is running in the clone (found through `/proc`), or if the interval is 0.
  - Index, HEAD, ref and reflog locks are never removed, only named.
- `compose.yaml` and `.env.example` gain `NAVBOOK_MAINTENANCE_INTERVAL_MS`. The Dockerfile comment explains why tini stays. Docs are updated in the server README, the root README and spec 06 §6.3.

Concurrency: git documents the geometric repack and the incremental commit-graph write as safe beside other gits. The issue's stress test (900 server-style operations beside back-to-back `pack-refs`) had 0 failures: when the two race, `pack-refs` is the one that gives way. Git's own detached maintenance overlapped requests the same way, so this is not new exposure.

## Verification

- Lint, typecheck, and every suite pass: core 885, server 422, plugin-kb 138, conformance 128, deploy 73, web e2e 169.
- CLI: 401 of 402 pass. The one failure is `nav issue list on 1000 issues`, which fails identically on `dev` under full-suite load (920 ms against a 500 ms budget) and passes alone. This branch does not touch the CLI's path.
- New tests, each checked to fail against the old code:
  - the issue's regression, with a planted `packed-refs.lock` and a branch deleted on origin;
  - no detached maintenance in the clone, checked with a GIT_TRACE2 trace;
  - a stop that waits for a short run, and one that stops a long run whole;
  - a lock kept while a git runs in the clone;
  - the entrypoint's seed starts no maintenance;
  - unit tests for the runner, the clock, the leftovers and the git config count.
- **Production image** (git 2.54, tini as PID 1, the branch's entrypoint and server run from source):
  - A run's parent is `nav-server`; it leads its own group, with `repack` and `pack-objects` in it.
  - `docker stop` during a long repack took 6.06 s, exit 0, and left no lock and no partial pack.
  - A restart over planted leftovers removed them and named the cut-short `refs/heads/main.lock`.
  - A git napping in the clone at startup kept its lock.
- **Unrelated, found here:** the API image does not build on `dev` since the plugin merge (#uniyh2hy), which is why the image check ran the branch from source.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
