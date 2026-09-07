#!/bin/sh
#
# Make the clone the server needs, then become the server.
#
# The API works against its own checkout rather than a database, so a container
# with an empty volume has nothing to serve until one exists. This makes it: on
# the first start it fetches the repository, and on every start it tells git who
# the commits are by and how to authenticate. Then it steps out of the way —
# `exec`, so the server is PID 1 and `docker stop` reaches the signal handler
# that drains a mutation between its commit and its push.
#
# Nothing is written into the volume's git config. Identity and credentials are
# passed through the environment (`GIT_CONFIG_COUNT` and friends), which every
# git the server runs inherits, so rotating a token is a restart rather than an
# edit inside a running container — and `git config --list` in there never shows
# the token.
#
# What it deliberately does not do is repair a clone. A dirty tree or a detached
# HEAD is how a conflict the server refused to resolve is left for a person to
# reconcile; throwing it away on the next restart would discard exactly the work
# that was being kept.

set -eu

repo=${NAV_SERVER_REPO:-/srv/navbook}
# The server's own variable, not a second one: the remote this makes is the
# remote it synchronises with, and two names for that could disagree.
remote=${NAV_SERVER_REMOTE:-origin}

fail() {
  echo "navbook-entrypoint: $1" >&2
  exit 1
}

[ -n "${NAVBOOK_REPO_URL:-}" ] || fail "NAVBOOK_REPO_URL is required: the repository to serve"
[ -n "${NAVBOOK_GIT_NAME:-}" ] || fail "NAVBOOK_GIT_NAME is required: who the commits are by"
[ -n "${NAVBOOK_GIT_EMAIL:-}" ] || fail "NAVBOOK_GIT_EMAIL is required: who the commits are by"

# Configuration through the environment, continuing whatever the caller already
# put there rather than overwriting it.
count=${GIT_CONFIG_COUNT:-0}
git_config() {
  export "GIT_CONFIG_KEY_${count}=$1" "GIT_CONFIG_VALUE_${count}=$2"
  count=$((count + 1))
  export GIT_CONFIG_COUNT="$count"
}

git_config user.name "$NAVBOOK_GIT_NAME"
git_config user.email "$NAVBOOK_GIT_EMAIL"

if [ -n "${NAVBOOK_GIT_TOKEN:-}" ]; then
  # The helper names the variables rather than holding their values, so the
  # token stays in the environment and out of any config git can print. Git
  # appends the operation it wants, and only `get` has an answer.
  export NAVBOOK_GIT_USERNAME=${NAVBOOK_GIT_USERNAME:-x-access-token}
  git_config credential.helper \
    '!f() { [ "$1" = get ] || exit 0; printf "username=%s\npassword=%s\n" "$NAVBOOK_GIT_USERNAME" "$NAVBOOK_GIT_TOKEN"; }; f'
fi

# Where the deployment points, on every start rather than only the first: the
# volume should not be the thing that outranks the configuration.
point_at_remote() {
  if git -C "$repo" remote get-url "$remote" > /dev/null 2>&1; then
    git -C "$repo" remote set-url "$remote" "$NAVBOOK_REPO_URL"
  else
    git -C "$repo" remote add "$remote" "$NAVBOOK_REPO_URL"
  fi
}

mkdir -p "$repo"

# A commit is the completed unit here, so "has a commit" is what makes a clone
# usable — and what makes a seed interrupted halfway one to make again rather
# than one to serve.
if git -C "$repo" rev-parse --verify -q HEAD > /dev/null 2>&1; then
  echo "navbook-entrypoint: serving the clone already in $repo"
  point_at_remote
else
  branch=${NAVBOOK_BRANCH:-}
  if [ -z "$branch" ]; then
    branch=$(git ls-remote --symref "$NAVBOOK_REPO_URL" HEAD |
      sed -n 's|^ref: refs/heads/\(.*\)[[:space:]]HEAD$|\1|p')
    [ -n "$branch" ] ||
      fail "$NAVBOOK_REPO_URL names no default branch; set NAVBOOK_BRANCH to the one to serve"
  fi

  echo "navbook-entrypoint: fetching $NAVBOOK_REPO_URL ($branch) into $repo"
  # init, fetch and checkout rather than clone: this is the sequence willing to
  # finish a seed the last start left half-made, and the one that does not mind
  # a mount point something else has already put a file in. A half-made one
  # already has its branch, and re-passing --initial-branch only earns a warning.
  [ -d "$repo/.git" ] || git -C "$repo" init -q -b "$branch"
  point_at_remote
  git -C "$repo" fetch -q "$remote"
  git -C "$repo" checkout -q -B "$branch" "$remote/$branch"
fi

cd "$repo"
exec nav-server "$@"
