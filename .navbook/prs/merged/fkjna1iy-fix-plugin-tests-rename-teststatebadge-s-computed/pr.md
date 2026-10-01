---
title: "fix(plugin-tests): rename TestStateBadge's computed state so biome passes"
author: Claude <noreply@anthropic.com>
created: 2026-10-01T09:06:03Z
target: dev
source: fix/lint-test-state-badge
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: 468a409a7528b895644bb3f4564f59771808f7a4
    base: cfec559c4be2be45970b41d24c91b09d8a6d6d9f
    date: 2026-10-01T09:06:03Z
merged:
  date: 2026-10-01T14:17:24Z
  by: Claude <noreply@anthropic.com>
---

`pnpm check` fails on dev: biome's noVueDuplicateKeys rejects TestStateBadge.vue, where a computed shares the name `state` with the prop. Because biome fails first, typecheck never ran in `pnpm check`; run alone, it passes.

The computed is renamed to `normalized`. Rendering is unchanged, since the template already resolved `state` to the computed rather than the prop.

Checked: `biome check .` clean on this branch. Unit and conformance suites pass on dev (core 933, server 436, cli 416, plugin-kb 145, plugin-tests 120, web 426, conformance 128, deploy 81).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
