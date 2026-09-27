---
title: "The API image no longer builds: plugin-kb is packed without its dependencies"
author: Claude <noreply@anthropic.com>
created: 2026-09-27T21:21:05Z
assignee: Claude <noreply@anthropic.com>
labels: [bug, ops]
---

Found while verifying #cvb57nhm (2026-09-27): `docker build -f packages/server/Dockerfile .` fails on dev at `0956b00`, at the step that packs the tarballs. So `docker compose build`, the CI `docker` job and the deploy recipe cannot produce an API image. The last image that built here, `navbook-server:rcsql1v9`, predates the plugin merge (#ywz73dxu).

## Repro

```console
$ git switch dev && docker build -q -f packages/server/Dockerfile -t navbook-server:check .
#21 12.19 src/server/patch.ts(9,35): error TS2307: Cannot find module '@navbook/core' or its corresponding type declarations.
#21 12.19 src/server/index.ts(23,51): error TS2307: Cannot find module '@navbook/server/plugin' or its corresponding type declarations.
#21 12.24 [WARN]  Local package.json exists, but node_modules missing, did you mean to install?
ERROR: failed to solve: process "/bin/sh -c mkdir -p /out  && pnpm --filter @navbook/core pack … && pnpm --filter @navbook/plugin-kb pack --pack-destination /out" did not complete successfully: exit code: 2
```

## Why

`packages/server/Dockerfile:35` installs dependencies with `--filter navbook-workspace --filter "@navbook/server..."`. That selects the server and what it depends on. plugin-kb depends on the server, not the other way round, so `packages/plugin-kb/node_modules` is never created, and its `prepack` (`tsc`) cannot resolve anything.

Adding `--filter "@navbook/plugin-kb..."` gets further but not through. plugin-kb's `./cli` half then fails on `@navbook/cli/plugin`, because the build stage copies only `packages/cli/package.json`, never its sources:

```console
#21 13.73 src/cli/index.ts(14,36): error TS2307: Cannot find module '@navbook/cli/plugin' or its corresponding type declarations.
```

So a fix has to either:
- also copy and build `packages/cli` in the build stage (and possibly `packages/web`, for plugin-kb's web half); or
- make plugin-kb's `prepack` able to build its server half without the others.

Then check that the `NAVBOOK_PLUGINS=` (empty) and `NAVBOOK_PLUGINS=@navbook/plugin-kb` builds both work. The web image was not checked.

## Acceptance

- [ ] `docker build -f packages/server/Dockerfile .` succeeds on a clean checkout, with `NAVBOOK_PLUGINS` empty and with `@navbook/plugin-kb`.
- [ ] `docker compose --env-file .env.example build` succeeds, as the CI `docker` job runs it.
- [ ] A test under `test/deploy/` fails when the build stage's install filter leaves out a package that is packed.
