---
title: Build the API image again, with and without plugin-kb
author: Claude <noreply@anthropic.com>
created: 2026-09-27T22:19:31Z
target: dev
source: fix/uniyh2hy-api-image-plugin-kb
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: 7ba07546f23c36f20b564756d1de842b73422bce
    base: ae9aac59e6675b95dadf50874ea94b50cf5a5a6a
    date: 2026-09-27T22:19:31Z
---

Fixes #uniyh2hy: `docker build -f packages/server/Dockerfile .` failed on `dev` since the plugin merge, so neither `docker compose build`, the CI `docker` job nor the deploy recipe could produce an API image.

## What was wrong

Two failures, the second hidden behind the first (details and logs in the issue's comment):

1. **Build stage.** The install selected `@navbook/server...`, which never reaches plugin-kb (it depends on the server, not the reverse), so plugin-kb's `prepack` had no `node_modules`. It also imports `@navbook/cli/plugin`, which resolves to cli's TypeScript source in the workspace, and only cli's manifest was copied.
2. **Runtime install, with `NAVBOOK_PLUGINS=@navbook/plugin-kb`.** npm resolves plugin-kb's optional web peers, and `@vue/apollo-composable`'s optional `@vue/composition-api` peer pulls that resolution to Vue 2, conflicting with plugin-kb's `vue ^3.5` (ERESOLVE). `nav plugin install` already passes `--legacy-peer-deps` for exactly this (`packages/cli/src/plugins/store.ts`).

## Change

- `packages/server/Dockerfile`: install `--filter "@navbook/plugin-kb..."` too, copy `packages/cli` whole, and pass `--legacy-peer-deps` to the runtime `npm install`. Core is still the single tarball named on that command line.
- `test/deploy/images.test.ts`: two tests that every package the API image packs has its workspace dependencies installed by the build stage's filters and copied as sources, not just as a manifest. Both fail against the old Dockerfile (they name `@navbook/plugin-kb` and `@navbook/cli`).

## Verified

- `docker build -f packages/server/Dockerfile .` succeeds with `NAVBOOK_PLUGINS` empty and with `@navbook/plugin-kb`.
- `docker compose --env-file .env.example build` succeeds, as CI runs it (the web image already built on `dev`).
- The plugin-kb image holds one `@navbook/core` and no Vue; both `@navbook/plugin-kb/server` and `/core` import. Against a bare remote declaring the plugin, it logs `loaded plugin @navbook/plugin-kb@0.4.0` and `nav-server listening`. The empty-plugins image refuses that repository at start, as it should.
- `tsc --noEmit`, `biome check .`, and `test/deploy` (70/70) pass.

Not covered: the web image with `NAVBOOK_WEB_PLUGINS=@navbook/plugin-kb`, which the issue doesn't ask for.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
