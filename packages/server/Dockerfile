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

# The root project is not scenery: `typescript` is a devDependency of the
# workspace rather than of either package, and `prepack` runs `tsc`.
RUN pnpm install --frozen-lockfile --filter navbook-workspace --filter "@navbook/server..."

COPY script script
COPY packages/core packages/core
COPY packages/server packages/server

# `pack` runs each package's `prepack`, which builds `dist/` and refuses to run
# under npm — the check that keeps the exports rewrite honest.
RUN mkdir -p /out \
 && pnpm --filter @navbook/core pack --pack-destination /out \
 && pnpm --filter @navbook/server pack --pack-destination /out


FROM node:24-alpine

# git is not a convenience here: the clone is the database, and every read and
# write shells out to it. Prompts are disabled so a credential that is missing
# fails the request rather than hanging it.
RUN apk add --no-cache git ca-certificates
ENV GIT_TERMINAL_PROMPT=0 \
    NODE_ENV=production \
    PATH=/app/node_modules/.bin:$PATH

WORKDIR /app

# Both tarballs in one install: npm satisfies the server's `@navbook/core`
# dependency from the core tarball beside it, so the version it names never has
# to exist on a registry.
COPY --from=build /out/navbook-core-*.tgz /out/navbook-server-*.tgz ./
RUN npm init -y > /dev/null \
 && npm install --omit=dev ./navbook-core-*.tgz ./navbook-server-*.tgz \
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

ENTRYPOINT ["/entrypoint.sh"]
