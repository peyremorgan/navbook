---
title: "Plugin host seams for services: sync events, acting as a person, a stop deadline"
author: Claude <noreply@anthropic.com>
created: 2026-10-14T00:55:08Z
target: dev
source: feat/server-service-seams
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: f73f745cbd1efaafa672efa7d6bf8320cad6eb44
    base: 5ed0ecb6e697b4b1925b8d67ca08fd4dcdff8f32
    date: 2026-10-14T00:55:08Z
---

The first of two pull requests for #xsd6wgvi: the seams `nav-server`'s plugin host needs before a chat bridge can live in it as a service (spec 06 §6.2). The second, `@navbook/plugin-discord`, is stacked on this one.

## In this pull request

- **`host.onSync(listener)`**: told after every pull that fetched — the background pull's, or a read's own — and every write, once the clone has let go. A mutation listener never heard of what somebody pushed from a terminal; this is how a service does. `RepoSync` fires it from the operation's continuation, outside the lock, since the lock's holder is visible to everything a locked body starts and a listener scheduled from there would have had `execute` refused.
  - A write's sync event comes after its mutation event, so a service hearing both knows the write for the API's first.
  - Listeners are told nothing while services are not running, and nothing about what an operation they started did: with `--pull-interval-ms 0` a listener that reads would fetch, be told, and read again, for ever.
- **`host.api.contextFor(person?)`**: the context that person's request would have had, for a service with no request in flight. `author:` records them, the clone commits, the mutation event names them. No token vouches for them, so only `--allow-email-domain` among the admission rules can apply, and does — refused as at the door, with the reason in the log and not in the error. A person the format could not write as `author:` is refused. With no person, the context acts as the server itself, for reading.
- **A shutdown deadline**: services are given ten seconds in all to `stop`; one still running then is left to the process exit, and the log says so.
- `core.listRefShasAsync(cwd, prefixes)`, for a listener comparing refs between two moments. An annotated tag is given the commit it tags.
- Plugin API version 1.2.0. The docs (`doc/plugins.md`, the server README) say how to use all of it.

The `fix(server)` commit fixes what `/code-review high` found: the listener feedback loop with background pulls off, listeners told outside their service's lifetime, the refusal's reason handed to the plugin, the order of the sync and mutation events, annotated tags, a per-service rather than shared stop deadline, a wrong name in the host's docs, and a second copy of the stamp format.

## Testing

- `packages/server`: the sync engine's firing rules driven through its scripted git (once per operation, never under the lock, a failed fetch tells nothing, a throwing listener is reported); the runtime's dispatch, lifecycle gate and shared deadline; and, over a real server with the probe plugin, a peer's push heard through the background pull, the event order, no loop with background pulls off, acting as a person end to end, and the two refusals.
- Every suite passes: core, server, cli, conformance, deploy, and the four plugins'.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
