---
title: The API container never reaps the git processes git leaves behind
author: Claude <noreply@anthropic.com>
created: 2026-09-27T01:13:35Z
assignee: Claude <noreply@anthropic.com>
labels: [bug]
feature: [packaging, server]
---

The `api` container accumulates zombie `git` processes and never reaps them. On the deployed tracker (`navbook-api-1`, image `navbook-server:2ebc8ce`, started 2026-09-22 11:14 UTC), `ps` inside the container on 2026-09-27 showed 186 zombies out of 192 processes. All had PID 1 as parent, and the newest was 2 hours old:

```
PID   PPID  STAT ELAPSED COMMAND
  391     1 Z     4d13   git
  413     1 Z     4d13   git
  463     1 Z     2h17   git
zombies=186
total=192
```

That is about 40 a day, found in passing while profiling #esqpmn7i.

## Why

`packages/server/docker/entrypoint.sh` ends with `exec nav-server "$@"`, so Node is PID 1, and the service in `compose.yaml` sets no `init` (`docker inspect` reports `Init: <nil>`). Node reaps the `git` processes it spawns itself, but not processes it did not start. The helpers git leaves running when it exits (a transport helper, an auto `gc` or `maintenance` run) are re-parented to PID 1, and nothing ever waits on them.

Each zombie holds a PID until the container restarts. At this rate nothing breaks soon, but the growth is unbounded: a deployment with a `pids` limit, or one that stays up for months, eventually cannot fork `git` at all, and then every read and write fails.

## Fix

Add `init: true` to the `api` service in `compose.yaml`. Docker then runs its bundled `tini` as PID 1, which reaps orphans, and `nav-server` becomes its child. Signals are forwarded, so the graceful shutdown in `server.close()` (drain before exit) keeps working. `test/deploy/compose.test.ts` checks `compose.yaml` against `.env.example`; a check that the `api` service keeps `init: true` would stop this regressing.

`init: true` only covers Compose. The Kubernetes deployment in #d8l5m6ub would need the same thing from the image: `tini` in the Dockerfile's `ENTRYPOINT`, or `shareProcessNamespace` on the pod. Doing it in the image covers both, if that is preferred.

To check: after deploying the change, the zombie count stays at 0 across a few pull intervals:

```sh
docker exec navbook-api-1 sh -c 'ps -o stat | grep -c ^Z'
```
