# The web client: a bundle, and a file server to hand it out.
#
# There is no second Node process to deploy. `nuxi generate` emits static files
# and every byte of data comes from the API at runtime, so what runs here is
# nginx and what it needs to be told is where the API is — written into
# `config.json` when the container starts, which is why one image serves every
# deployment.
#
# Build it from the repository root, which is where a pnpm workspace install
# finds its lockfile:
#
#   docker build -f packages/web/Dockerfile -t navbook-web .

FROM node:24-alpine AS build

RUN npm install -g pnpm@11.18.0

WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/

# The whole package, before the install rather than after it: `postinstall` runs
# `nuxi prepare`, which reads this configuration and writes the .nuxt/ the build
# then uses. Core is a devDependency here and only `script/fixture-repo.ts`
# imports it, so its manifest above is enough to satisfy the workspace link.
COPY packages/web packages/web

RUN pnpm install --frozen-lockfile --filter navbook-workspace --filter "@navbook/web..."
RUN pnpm --filter @navbook/web build


FROM nginx:alpine

COPY packages/web/docker/nginx.conf /etc/nginx/conf.d/default.conf

# nginx runs what is executable here before it starts. The number keeps it after
# the image's own envsubst step rather than racing it.
COPY --chmod=755 packages/web/docker/config.sh /docker-entrypoint.d/25-navbook-config.sh

COPY --from=build /src/packages/web/.output/public /usr/share/nginx/html

EXPOSE 80

# Asking for config.json rather than a page: it is the file the start-up script
# writes, so a container that answers it is one that was configured, not merely
# one whose nginx came up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD \
  wget -q -O /dev/null http://127.0.0.1/config.json || exit 1
