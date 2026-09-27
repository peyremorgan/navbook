---
title: Background pull, lighter parsing and a remembered tree for the API's reads
author: Claude <noreply@anthropic.com>
created: 2026-09-27T00:32:52Z
target: dev
source: perf/server-reads
reviewer: morgan.peyre@brickcode.tech
labels: [performance]
feature: server
revisions:
  - head: f788603cd578b4b2508649bd0e63ef45951c94ba
    base: da9c30a87ffd472bc62542234421178e45db2bc5
    date: 2026-09-27T00:32:52Z
---

Closes #esqpmn7i.

`Issue`, `Issues`, `Features` and `People` took more than 4 s each on the deployed tracker. All four sat behind one lock, and between them paid for a fetch and six full parses of the tree. This branch takes the fetch off the request path, parses once per request, reads only the comments a request needs, parses flat frontmatter without `yaml`, and finally remembers the parse across requests. The last step is deliberately last, so that each earlier one could be measured without a cache hiding it.

## Results

`bench-reads` (added here) sends the web client's own issue-page queries against a 2 194-file tree, about the deployed one's size, with a 2.2 s fetch. Baseline and branch were run back to back, medians of 5:

| issue page | before | after |
|---|---|---|
| warm | 896–1 213 ms | 91 ms |
| first load after an idle pull interval | 2 897–3 215 ms | 103–110 ms |

On the production host, read-only against the live tree (853 entities), the new core parses the tree in 269 ms against 586 ms, with identical results for every entity. The full figures and the per-step profile are on #esqpmn7i.

## Commits

- `2239cd2`, `a9ec090`: `packages/server/script/bench-reads.ts`, with `PROFILE=1` for a CPU profile of tree loads.
- `dbf95fd`: the background pull. Reads skip their own pull while it keeps up, and fall back to it otherwise, so freshness and sync errors are unchanged. Fetch and push are serialised.
- `c098935`: `ctx.loadRepo()`. A root resolver's parse becomes the request's `repo()`.
- `8597f40`: `commentsLoaded`, `withComments` and `ctx.commented()`. Fixes `issues { comments }` answering `[]`.
- `9663c21`: `core/flat-yaml.ts`, with a lazily built `Document`, and a `splitFrontmatter` that no longer splits the whole file into lines.
- `1a60a61`: `TreeCache`, keyed on HEAD, dropped on every write, with a `git status` watchdog for hand edits. A pull interval of 0 turns it off.

## Behaviour to review

- A file edited by hand in the served clone is seen within one pull interval, instead of on the next read. With `--pull-interval-ms 0` it is still seen at once.
- While the background pull is failing, reads fetch for themselves as they did before, so a dead remote still yields `SYNC_FAILED` rather than silently stale answers.
- `features` now reads without comments. A member's comments, and a pull request's review state, are read on demand through `ctx.commented()`.

## Tests

core 761, server 375, CLI 348, conformance 117, deploy 59, web 373. Lint and typecheck are clean. New: the `flat-yaml` differential test, unit tests for the background pull, the context, the tree cache and the write hook, and `tree-cache.test.ts` over HTTP with a 200 ms interval (the server's own writes, a peer's push, repeated hand edits).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
