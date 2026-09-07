#!/bin/sh
#
# Write the handful of facts the bundle cannot know.
#
# `nuxi generate` emits one artefact that has to serve every deployment, so the
# address of the API and of the identity provider are read from `config.json`
# beside it at boot rather than compiled in. This writes that file from the
# environment on every start, which is what makes the image reusable and what
# makes changing an address a restart.
#
# nginx runs everything executable in /docker-entrypoint.d before it starts, so
# a missing value stops the container here — where the message is the first
# thing in the log — rather than three screens into the app.

set -eu

root=${NAVBOOK_WEB_ROOT:-/usr/share/nginx/html}

fail() {
  echo "navbook-config: $1" >&2
  exit 1
}

# Check a value and escape it for JSON in one pass, because every value here
# goes through both and neither is worth doing twice.
required() {
  name=$1
  value=$2
  [ -n "$value" ] || fail "$name is required: $3"
  # A line break would make the file unparseable, and the app's error would
  # name the key without saying what was wrong with it.
  [ "$(printf '%s' "$value" | wc -l)" -eq 0 ] || fail "$name must not contain a line break"
  printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

[ -d "$root" ] || fail "$root is not there; nothing to configure"

# The bundle ships the development one, and a start that cannot write a good
# file must not leave a stale file behind: serving yesterday's addresses is a
# worse failure than serving none, because nothing about it looks wrong.
rm -f "$root/config.json"

graphql_url=$(required NAVBOOK_GRAPHQL_URL "${NAVBOOK_GRAPHQL_URL:-}" \
  "the address the browser sends GraphQL to")
oidc_issuer=$(required NAVBOOK_OIDC_ISSUER "${NAVBOOK_OIDC_ISSUER:-}" \
  "the OIDC issuer to sign in against")
oidc_client_id=$(required NAVBOOK_OIDC_CLIENT_ID "${NAVBOOK_OIDC_CLIENT_ID:-}" \
  "the OIDC client to sign in as")
oidc_audience=$(required NAVBOOK_OIDC_AUDIENCE "${NAVBOOK_OIDC_AUDIENCE:-}" \
  "the audience tokens must carry")

cat > "$root/config.json" <<JSON
{
  "graphqlUrl": "$graphql_url",
  "oidc": {
    "issuer": "$oidc_issuer",
    "clientId": "$oidc_client_id",
    "audience": "$oidc_audience"
  }
}
JSON

echo "navbook-config: $root/config.json points at $graphql_url"
