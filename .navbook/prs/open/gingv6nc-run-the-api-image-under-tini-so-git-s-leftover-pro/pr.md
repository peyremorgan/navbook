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
---

Fixes #rcsql1v9: the API container never reaped the zombie `git` processes that git's own background gc and maintenance leave to PID 1.

## Change

- `packages/server/Dockerfile`: `apk add … tini`, and `ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]`. tini is PID 1, reaps orphans and forwards signals; `nav-server` is its child.
- `packages/server/docker/entrypoint.sh`: the header comment no longer says the server is PID 1.
- `test/deploy/images.test.ts`: asserts the image installs tini and starts through it. It fails on `dev`.

The fix goes in the image instead of Compose's `init: true` (the issue's first suggestion) so that the Kubernetes deployment in #d8l5m6ub gets it as well. A deployment that also sets `init: true` still works: tini just runs as a child of docker-init.

## Verification

Built `navbook-server:rcsql1v9` from this branch. Each image ran with its real entrypoint against a bind-mounted bare remote, with `NAV_SERVER_PULL_INTERVAL_MS=1000`, while the host pushed a commit every 2 s for 40 s:

| image | PID 1 | zombies after ~45 s | `docker stop` |
|---|---|---|---|
| `7d8662c` (prod today) | `node` | **63** | "received SIGTERM, finishing in-flight work", exit 0 |
| this branch | `tini` | **0** | same log line, exit 0 |

An entrypoint failure (no `NAVBOOK_REPO_URL`) still exits 1 through tini.

- `node --test "test/deploy/**/*.test.ts"`: 60/60 pass. The 4 tests that read `packages/web/.output` need a web build and don't run in a worktree.
- `biome check` is clean.

## After deploy

`docker exec navbook-api-1 sh -c 'ps -o stat | grep -c ^Z'` should stay at 0 across a few pull intervals. The image grows by the tini binary, about 40 KB.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
