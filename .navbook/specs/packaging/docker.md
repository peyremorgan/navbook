---
title: Docker
---

## What exists

Two container images and a compose file, for deploying the API and the web client behind a Traefik that is already running (spec 06 §6.3).

- `packages/server/Dockerfile` — a build stage that packs the `@navbook/core` and `@navbook/server` tarballs `pnpm publish` would upload, and a runtime stage of `node:24-alpine` plus git that installs them. What runs is the `dist/` the registry serves, through the same `publishConfig.exports` rewrite, rather than an arrangement that only holds inside the workspace.
- `packages/server/docker/entrypoint.sh` — the deployment's only stateful logic. It fetches the repository into the volume on the first start and finishes one a previous start left half-made, and it passes identity and credentials to git through `GIT_CONFIG_COUNT` rather than writing them into the clone, so a rotated token is a restart. It does not repair a clone: a dirty tree is how a `SYNC_CONFLICT` is left for a person to reconcile.
- `packages/web/Dockerfile` — the generated bundle in nginx, with `docker/config.sh` writing `config.json` from the environment at every start and `docker/nginx.conf` serving `200.html` for unknown paths. One image serves every deployment, which is the same reason the address is not compiled in.
- `compose.yaml` and `.env.example` — one `NAVBOOK_` namespace mapped onto the variables the images actually read, so the server keeps the names its own README documents. Keys with no sensible default are refused at `up` rather than at somebody's first mutation.

The clone is the only volume, because it is the only durable state; it can be deleted and the next start makes it again. Neither container is on a network with the other, because the browser talks to both and the API answers any origin.

## Where it lives

- `compose.yaml`, `.env.example`, `.dockerignore`
- `packages/server/Dockerfile`, `packages/server/docker/`
- `packages/web/Dockerfile`, `packages/web/docker/`
- `test/deploy/`, and the `docker` job in `.github/workflows/ci.yml`

## Drift from the specification

- The specification does not describe deployment. Spec 06 §6.3 defines the server and the client this packages, not how they are shipped.
- Nothing is published to a registry. `docker compose up --build` builds from a checkout, so a deployment follows a clone rather than a tag.
- Traefik is assumed rather than configured, and is the only reverse proxy the labels describe. Anything else has to read the two hostnames off `.env` itself.
