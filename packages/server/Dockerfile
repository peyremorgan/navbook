# The API server, packaged the way it is published.
#
# The build stage packs the two tarballs `pnpm publish` would upload and the
# runtime stage installs them, so the image runs `dist/` through the same
# `publishConfig.exports` rewrite the registry gets rather than a private
# arrangement that only holds inside the workspace. What ships here is what
# `npx @navbook/server` would give anyone.
#
# Build it from the repository root, which is where a pnpm workspace install
# finds its lockfile:
#
#   docker build -f packages/server/Dockerfile -t navbook-server .

FROM node:24-alpine AS build

# Not corepack: it is bundled with Node 24 but its version is whatever the image
# was cut with, and an old one fails on registry key rotation. Naming the
# version the workspace names is one less thing that can drift.
RUN npm install -g pnpm@11.18.0

WORKDIR /src

# The manifests first, so a change to a source file does not re-resolve the
# whole dependency graph. `cli` and `web` are here for their manifests alone:
# the lockfile has an importer for each, and --frozen-lockfile checks them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/plugin-kb/package.json packages/plugin-kb/

# The root project is not scenery: `typescript` is a devDependency of the
# workspace rather than of either package, and `prepack` runs `tsc`.
RUN pnpm install --frozen-lockfile --filter navbook-workspace --filter "@navbook/server..."

COPY script script
COPY packages/core packages/core
COPY packages/server packages/server
COPY packages/plugin-kb packages/plugin-kb

# `pack` runs each package's `prepack`, which builds `dist/` and refuses to run
# under npm — the check that keeps the exports rewrite honest.
# A workspace plugin is packed like the other two, so the image installs the
# tarball `pnpm publish` would upload rather than a private arrangement that
# only holds inside this repository. It is always packed and only installed
# when `NAVBOOK_PLUGINS` names it: packing costs a second, and a conditional
# COPY is not a thing a Dockerfile has.
RUN mkdir -p /out \
 && pnpm --filter @navbook/core pack --pack-destination /out \
 && pnpm --filter @navbook/server pack --pack-destination /out \
 && pnpm --filter @navbook/plugin-kb pack --pack-destination /out


FROM node:24-alpine

# git is not a convenience here: the clone is the database, and every read and
# write shells out to it. Prompts are disabled so a credential that is missing
# fails the request rather than hanging it.
#
# tini, because git does not wait for everything it starts: an auto gc or
# maintenance run is detached to carry on after the command that started it
# returns, and is re-parented to PID 1 when it finishes. Node reaps only the
# children it spawned, so with the server as PID 1 every such leftover stayed a
# zombie until the container restarted (#rcsql1v9). In the image rather than as
# Compose's `init: true`, so that a pod gets it too.
RUN apk add --no-cache git ca-certificates tini
ENV GIT_TERMINAL_PROMPT=0 \
    NODE_ENV=production \
    PATH=/app/node_modules/.bin:$PATH

WORKDIR /app

# The plugins this image carries, as `.env` names them (spec 02 §2.12).
#
# A build argument rather than an environment variable, because a plugin is
# part of the image the way the Navbook version is: the server resolves them
# from beside itself, so they have to be installed here, not chosen at boot.
# The clone's `navbook.json` still decides which of them a repository *uses* —
# and the server refuses to start if it declares one this image lacks, which is
# how a mismatch between the two is found at deploy time rather than later.
ARG NAVBOOK_PLUGINS=""

# Both tarballs in one install: npm satisfies the server's `@navbook/core`
# dependency from the core tarball beside it, so the version it names never has
# to exist on a registry. Plugins join the same install, so a plugin's
# `@navbook/core` peer is satisfied by that same tarball rather than by a
# second copy fetched from the registry — the one thing that must not happen.
COPY --from=build /out/*.tgz ./
# `NAVBOOK_PLUGINS` names packages; a workspace one resolves to the tarball
# beside it and anything else to the registry, which is why the two are
# installed together rather than in two steps.
RUN npm init -y > /dev/null \
 && for name in $NAVBOOK_PLUGINS; do \
      case "$name" in \
        @navbook/plugin-*) set -- "$@" "./navbook-plugin-${name#@navbook/plugin-}-"*.tgz ;; \
        *) set -- "$@" "$name" ;; \
      esac; \
    done \
 && npm install --omit=dev --ignore-scripts \
      ./navbook-core-*.tgz ./navbook-server-*.tgz "$@" \
 && rm -f ./*.tgz \
 && npm cache clean --force

# A named volume takes its ownership from the directory it covers, so this is
# what lets an unprivileged server write its own clone.
RUN mkdir -p /srv/navbook && chown node:node /srv/navbook

COPY --chmod=755 packages/server/docker/entrypoint.sh /entrypoint.sh

USER node
# The clone, so that `docker compose exec api sh` puts a person in the thing
# they came to look at. The entrypoint still moves there itself, for when
# NAV_SERVER_REPO names somewhere else.
WORKDIR /srv/navbook
EXPOSE 4000

# Yoga answers /health before the context that checks a token, so this asks
# nothing of the identity provider — and says the server is up, not that its
# remote is reachable, which is the difference between a restart helping and a
# restart looping.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD \
  node -e "const p=process.env.NAV_SERVER_PORT||4000;fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# tini forwards the signals it receives, so `docker stop` still reaches the
# server's drain. `-s` makes it a subreaper, so it still collects the leftovers
# when something else is PID 1: Compose's `init: true`, `docker run --init`, or
# a pod sharing its process namespace.
ENTRYPOINT ["/sbin/tini", "-s", "--", "/entrypoint.sh"]
