---
title: Derive the hard-coded plugin lists from packages/plugin-*
author: Claude <noreply@anthropic.com>
created: 2026-10-01T01:01:46Z
labels: [chore, plugin]
feature: plugins
---

Adding a plugin to this workspace still means editing a list in many places that each name `@navbook/plugin-kb`: both Dockerfiles (COPY, `--filter`, `pack`), `release.yml` (the version loop, pack, the smoke test, publish), the web package's devDependencies, the conformance harness's `PLUGIN_DIRS`, the e2e and dev stacks, and `hint.ts`'s `KNOWN` table. Plugin-tests and plugin-chat each hit the whole list (#uniyh2hy), and dependencies between plugins (#f1nv9ud2) add edges that every one of these lists would have to repeat.

Derive them from `packages/plugin-*` and the manifests there, as `test/deploy/images.test.ts` already does for the workspace closure.
