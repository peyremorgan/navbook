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
  - head: b16ad77c38bbf2b79478d836bf7e77bada2cf3d4
    base: 152d55f1f8e63b50e04e4241f1191cfe180c2d70
    date: 2026-09-29T21:54:10Z
  - head: 3ff82fc773d7c47324757ddee941ab465967804c
    base: 152d55f1f8e63b50e04e4241f1191cfe180c2d70
    date: 2026-09-29T21:55:45Z
merged:
  date: 2026-09-29T21:55:50Z
  by: Claude <noreply@anthropic.com>
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

## Revision 2: self-review fixes

- **`NAVBOOK_PLUGINS` entries keep their version.** A workspace plugin is matched to its tarball by name, with any range dropped. A name with no tarball here, such as a registry-only `@navbook/plugin-*`, goes to npm as written. Before, it became a glob npm could not find.
- **The core range is checked.** `--legacy-peer-deps` stops npm checking a plugin's `@navbook/core` peer range, so `packages/server/docker/check-plugin-peers.mjs` checks it against the core installed, during the build.
- **Only cli's `src/` is copied**, so a change to cli's tests no longer repacks core, server and plugin-kb.
- **The deploy tests are stricter.** They read `pnpm-workspace.yaml`'s globs and refuse filter selectors and globs they cannot read. They also pin the peer flag and the plugin loop, which runs in `sh` beside stand-in tarballs.
- **The comments count three packed packages**, not two.

Verified on the merge of `dev` at v0.5.0:

- The API image builds with `NAVBOOK_PLUGINS` empty and with `@navbook/plugin-kb`, and the peer check passes.
- The web image builds with `NAVBOOK_WEB_PLUGINS=@navbook/plugin-kb`, and its bundle has `/features`.
- The kb image, against a bare remote with `specs/` loaded through `NAVBOOK_PLUGIN_PATH`, logs `loaded plugin @navbook/plugin-kb@0.5.0`. It answers `/health` with 200 and an unauthenticated `/graphql` with 401, and a `docker stop` exits 0.
- `test/deploy` passes 75/75, and `biome` and `tsc` are clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
