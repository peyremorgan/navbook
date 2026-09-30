# The API server, packaged the way it is published.
#
# The build stage packs the tarballs `pnpm publish` would upload — core, the
# server and the workspace's plugins — and the runtime stage installs them, so the image runs `dist/` through the same
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
# whole dependency graph. `web` is here for its manifest alone: the lockfile
# has an importer for it, and --frozen-lockfile checks them all.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/plugin-kb/package.json packages/plugin-kb/
COPY packages/plugin-tests/package.json packages/plugin-tests/

# The root project is not scenery: `typescript` is a devDependency of the
# workspace rather than of any package packed here, and `prepack` runs `tsc`.
# Every package packed below is selected with what it depends on, because its
# `prepack` compiles against them: plugin-kb depends on the server, not the
# other way round, so selecting the server alone never installs it (#uniyh2hy).
# The server is still named on its own: that plugin-kb's development happens to
# pull it in is not something the server's own build should rest on.
RUN pnpm install --frozen-lockfile --filter navbook-workspace \
      --filter "@navbook/server..." --filter "@navbook/plugin-kb..." \
      --filter "@navbook/plugin-tests..."

# Sources, for every workspace package a packed one compiles against. The
# plugins import `@navbook/cli/plugin`, which resolves to cli's TypeScript
# source in the workspace, so cli's `src/` is here although it is never packed
# — its source alone, so a change to cli's tests does not repack the rest. web stays a
# manifest: nothing packed here imports it.
COPY script script
COPY packages/cli/src packages/cli/src
COPY packages/core packages/core
COPY packages/server packages/server
COPY packages/plugin-kb packages/plugin-kb
COPY packages/plugin-tests packages/plugin-tests

# `pack` runs each package's `prepack`, which builds `dist/` and refuses to run
# under npm — the check that keeps the exports rewrite honest.
# A workspace plugin is packed like core and the server, so the image installs the
# tarball `pnpm publish` would upload rather than a private arrangement that
# only holds inside this repository. It is always packed and only installed
# when `NAVBOOK_PLUGINS` names it: packing costs a second, and a conditional
# COPY is not a thing a Dockerfile has.
RUN mkdir -p /out \
 && pnpm --filter @navbook/core pack --pack-destination /out \
 && pnpm --filter @navbook/server pack --pack-destination /out \
 && pnpm --filter @navbook/plugin-kb pack --pack-destination /out \
 && pnpm --filter @navbook/plugin-tests pack --pack-destination /out


FROM node:24-alpine

# git is not a convenience here: the clone is the database, and every read and
# write shells out to it. Prompts are disabled so a credential that is missing
# fails the request rather than hanging it.
#
# tini, because git does not always wait for what it starts. Its automatic
# maintenance used to be detached and re-parented to PID 1, and Node reaps
# only the children it spawned, so with the server as PID 1 every such
# leftover stayed a zombie until the container restarted (#rcsql1v9). The
# server now runs that maintenance itself, in the foreground (#cvb57nhm), but
# a credential helper or a hook can still leave an orphan behind: tini stays
# as the backstop. In the image rather than as Compose's `init: true`, so that
# a pod gets it too.
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

# Core and the server in one install: npm satisfies the server's `@navbook/core`
# dependency from the core tarball beside it, so the version it names never has
# to exist on a registry. Plugins join the same install, so a plugin's
# `@navbook/core` peer is satisfied by that same tarball rather than by a
# second copy fetched from the registry — the one thing that must not happen.
COPY --from=build /out/*.tgz ./
# `NAVBOOK_PLUGINS` names packages as npm installs them. One this workspace
# packed resolves to its tarball beside the server — by its name, any version
# range dropped, since the tarball is the version this image is built from —
# and anything else goes to npm as written. That is why they are installed
# together rather than in two steps.
#
# `--legacy-peer-deps` for the reason `nav plugin install` passes it: npm
# otherwise resolves a plugin's optional peers, and refuses plugin-kb over its
# web half's, whose own optional `@vue/composition-api` peer wants a Vue 2
# (#uniyh2hy). That also stops npm checking `@navbook/core` against a plugin's
# peer range, so `check-plugin-peers.mjs` checks it once the install is done.
COPY packages/server/docker/check-plugin-peers.mjs ./
RUN npm init -y > /dev/null \
 && for spec in $NAVBOOK_PLUGINS; do \
      case "$spec" in \
        @*) rest="${spec#@}"; name="@${rest%%@*}" ;; \
        *) name="${spec%%@*}" ;; \
      esac; \
      tarball=""; \
      case "$name" in \
        @navbook/plugin-*) \
          for file in "./navbook-plugin-${name#@navbook/plugin-}-"[0-9]*.tgz; do \
            [ -e "$file" ] && tarball="$file"; \
          done ;; \
      esac; \
      set -- "$@" "${tarball:-$spec}"; \
    done \
 && npm install --omit=dev --ignore-scripts --legacy-peer-deps \
      ./navbook-core-*.tgz ./navbook-server-*.tgz "$@" \
 && node check-plugin-peers.mjs \
 && rm -f ./*.tgz check-plugin-peers.mjs \
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
