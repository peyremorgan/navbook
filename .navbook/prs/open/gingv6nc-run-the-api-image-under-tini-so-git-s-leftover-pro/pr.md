---
title: Run the API image under tini, so git's leftover processes are reaped
author: Claude <noreply@anthropic.com>
created: 2026-09-27T12:35:21Z
target: dev
source: fix/rcsql1v9-reap-git-zombies
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
revisions:
  - head: 3ca7d700912a5efb241af4cb83c8203a0cc2ff71
    base: d27dc6ccd1c9c8c52fc04ff1cee449084406c805
    date: 2026-09-27T12:35:21Z
  - head: 3ba95ea560fc46b9b4763ff011ced3bef9629be9
    base: d27dc6ccd1c9c8c52fc04ff1cee449084406c805
    date: 2026-09-27T12:52:45Z
---

Fixes #rcsql1v9: the API container never reaped the zombie `git` processes that git's own background gc and maintenance leave to PID 1.

## Change

- `packages/server/Dockerfile`: `apk add … tini`, and `ENTRYPOINT ["/sbin/tini", "-s", "--", "/entrypoint.sh"]`. tini is PID 1, reaps orphans and forwards signals; `nav-server` is its child. `-s` makes it a subreaper, so it still reaps when something else is PID 1.
- `packages/server/docker/entrypoint.sh`: the header comment no longer says the server is PID 1.
- `test/deploy/images.test.ts`: asserts the image installs tini and starts through it, with `-s`, handing over to `/entrypoint.sh`. It fails on `dev`.
- `test/deploy/compose.test.ts`: refuses an `entrypoint:` on the `api` service, which would replace tini along with the rest.

The fix goes in the image instead of Compose's `init: true` (the issue's first suggestion) so that the Kubernetes deployment in #d8l5m6ub gets it as well. A deployment that also sets `init: true` still works: tini runs as a subreaper under docker-init, with 0 zombies and no warning (checked with `docker run --init`).

## Verification

Built `navbook-server:rcsql1v9` from this branch. Each image ran with its real entrypoint against a bind-mounted bare remote, with `NAV_SERVER_PULL_INTERVAL_MS=1000`, while the host pushed a commit every 2 s for 40 s:

| image | PID 1 | zombies after ~45 s | `docker stop` |
|---|---|---|---|
| `7d8662c` (prod today) | `node` | **63** | "received SIGTERM, finishing in-flight work", exit 0 |
| this branch | `tini` | **0** | same log line, exit 0 |

An entrypoint failure (no `NAVBOOK_REPO_URL`) still exits 1 through tini.

- `node --test "test/deploy/**/*.test.ts"`: 61/61 pass. The 4 tests that read `packages/web/.output` need a web build and don't run in a worktree.
- `biome check` is clean.

## Out of scope

The self-review found that git's detached gc can still be SIGKILLed on stop and leave lock files in the clone. That was already the case before this change, and fixing it has a latency trade-off, so it is filed as #cvb57nhm.

## After deploy

`docker exec navbook-api-1 sh -c 'ps -o stat | grep -c ^Z'` should stay at 0 across a few pull intervals. The image grows by the tini binary, about 40 KB.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
