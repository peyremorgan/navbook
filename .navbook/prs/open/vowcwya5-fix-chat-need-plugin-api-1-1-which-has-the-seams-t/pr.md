---
title: "fix(chat): need plugin API 1.1, which has the seams the assistant calls"
author: Claude <noreply@anthropic.com>
created: 2026-10-06T22:41:16Z
target: dev
source: fix/plugin-chat-engines
reviewer: morgan.peyre@brickcode.tech
labels: [release]
revisions:
  - head: 010f4b443d93249595a2e2dcfb92c5a5cb12c8b5
    base: e928d0a477ac9e3d9407176e32e5377024a249fa
    date: 2026-10-06T22:41:16Z
---

plugin-chat now declares `engines.navbook: ^1.1.0` instead of `^1.0.0`. Found in the 0.6.0 pre-release checklist.

## Why

`engines.navbook` is the only guard between a plugin and a host too old for it. `nav plugin install` passes `--legacy-peer-deps`, so the `@navbook/core` peer range is never enforced. plugin-chat calls four seams a 1.0 host does not have:

- `host.api.execute` (server)
- `ui.withBranchWriteSite` and `ui.withPrWriteSite` (CLI)
- the `overlays` slot (web)

All four came in #g3xqbgn5, after v0.5.0. v0.5.0's host reports plugin API 1.0.0, so it accepted plugin-chat and failed only when the assistant reached a missing function.

The API version is already 1.1.0 on `dev` and 1.1.0 has never been released, so the seams ship together under it. No API bump is needed.

## Change

- `packages/plugin-chat/package.json`: `engines.navbook` goes from `^1.0.0` to `^1.1.0`.

plugin-kb is unchanged since v0.5.0 and stays at `^1.0.0`. plugin-tests already declares `^1.1.0`.

## Tests

- **Under the published `nav` 0.5.0** (API 1.0.0), with plugin-chat installed from its tarball into a scratch store and declared in a scratch repo:
  - Before: the plugin loads and `nav chat --help` is offered.
  - After: `nav: plugin @navbook/plugin-chat skipped: it needs a Navbook plugin API of ^1.1.0; this is 1.0.0`.
- **Under `dev`'s CLI** (API 1.1.0): `nav chat --help` loads as before.
- **Suites:** plugin-chat 149/149, `test:deploy` 78/78, Biome clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
