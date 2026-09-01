# @navbook/server

A GraphQL API over a Navbook repository — the server the web client sits on
([spec 06 §6.3](../../doc/spec/06-future.md)).

It imports [`@navbook/core`](../core) and runs the same operations `nav` runs.
Nothing about the format is reimplemented here, and nothing about it needs to
ship to a browser: clients send fields, and the server composes the files.

```sh
npx @navbook/server \
  --repo /srv/navbook-clone \
  --oidc-issuer https://accounts.example.com \
  --oidc-audience navbook
```

## What it is

**A clone, not a database.** The server works against its own checkout,
synchronised with a central origin: it pulls before every operation and pushes
after every mutation. Git remains the only durable state, and the clone can be
thrown away and made again. Nothing index-like is introduced.

**Read and write, on a person's behalf.** A request carries an OIDC bearer
token; its `name` and `email` claims become the identity the operation runs
under, so `author:` records the person while the commit is made by the machine
account. This is the non-committer gateway of
[spec 06 §6.2](../../doc/spec/06-future.md) — and the reason `author` is data
rather than derived from the committer.

**Conflicts surface, they are not resolved.** Contention with people working
from terminals is handled by the ordinary merge rules of
[spec 03 §3.3](../../doc/spec/03-merge-and-branches.md); the server gets no
privileged path. A push it cannot land is retried once after merging what
arrived; if that merge conflicts it is aborted and reported as
`SYNC_CONFLICT`, with the change left committed in the clone for an operator to
reconcile. The server never resolves somebody's conflict for them.

## Configuration

Every option has a flag and an environment variable. Flags win.

| Flag | Variable | Required | Default |
|---|---|---|---|
| `--repo <path>` | `NAV_SERVER_REPO` | no | the working directory |
| `--port <n>` | `NAV_SERVER_PORT` | no | `4000` (`0` binds any free port) |
| `--oidc-issuer <url>` | `NAV_SERVER_OIDC_ISSUER` | **yes** | — |
| `--oidc-audience <aud>` | `NAV_SERVER_OIDC_AUDIENCE` | **yes** | — |
| `--oidc-jwks-url <url>` | `NAV_SERVER_OIDC_JWKS_URL` | no | discovered from the issuer |
| `--remote <name>` | `NAV_SERVER_REMOTE` | no | `origin` |
| `--pull-interval-ms <n>` | `NAV_SERVER_PULL_INTERVAL_MS` | no | `10000` |
| `--no-graphiql` | `NAV_SERVER_GRAPHIQL=false` | no | the explorer is served |

`--pull-interval-ms` is how stale a *read* may let its view of the remote
become; a mutation always fetches first. There is no way to turn
authentication off: every operation, read or write, needs a valid token.

## Deploying it

- **Give the clone a committer identity.** `git config user.name` and
  `user.email` in the checkout: that is who the commits are *by*, while
  `author:` is who they are *for*.
- **Make pushing non-interactive.** An SSH key or a credential helper. The
  server runs git with prompts disabled, so a missing credential fails the
  request rather than hanging it.
- **One server per clone.** Operations are serialised against the single
  working tree.
- **Start it clean.** The server refuses to start on a dirty tree, a detached
  HEAD, or a repository with no `.navbook/` — each of those would otherwise
  surface as a puzzling failure on somebody's first mutation.
- **Authorization is out of scope.** Any token the issuer signs for this
  audience may write. Put the policy you need in front.

## The API

`schema.graphql` is the contract, and it ships with the package. The types
follow the canonical JSON projection of
[spec 04 §4.2](../../doc/spec/04-cli.md), so a client of this schema and a
reader of `nav --json` see the same shapes.

```graphql
query {
  issues(filter: { labels: ["bug"] }) {
    id
    title
    subtasks(depth: 2) { id issue { title } }
  }
}

mutation {
  openIssue(input: { title: "Login is broken", body: "It does not work." }) {
    issue { id }
    commit { committed pushed }
  }
}
```

Failures carry a machine-readable `extensions.code`: every
`WorkspaceErrorCode` from the core library (`NOT_FOUND`, `AMBIGUOUS`,
`PRECONDITION`, …), plus `UNAUTHENTICATED`, `SYNC_CONFLICT`,
`SYNC_PUSH_REJECTED`, and `REPARENT_REQUIRED`.

Two mutations have a shape worth knowing:

- **`linkIssue`** refuses with `REPARENT_REQUIRED` when the issue already has a
  parent, naming the one it has now. Moving a subtask changes a structure
  somebody else may be reading, so it takes an explicit `allowReparent: true`.
- **`updateIssue`** distinguishes an absent field from an explicit `null`: the
  first leaves the key alone, the second clears it. Frontmatter keys the schema
  does not name are always preserved.

### What it does not do

Pull request `merge`, `open` and `update`, entity `delete`, `init`, and
`doctor --fix` are not exposed; they are checkout-centric maintainer actions,
and `doctor` is read-only here. A pull request's files live on the branch it
proposes to merge, so `prs(allRefs: true)` can find one this checkout does not
hold, but commenting on it needs a server serving that branch — the refusal
says which one.

Two limits worth knowing at this scale: git runs synchronously, so a slow fetch
or push blocks concurrent requests; and two clients editing one issue are
last-write-wins rather than detected.

## Development

```sh
pnpm --filter @navbook/server start     # runs the TypeScript directly
pnpm --filter @navbook/server test
pnpm --filter @navbook/server codegen   # after editing schema.graphql
```

`src/generated/resolver-types.ts` is generated from `schema.graphql` and
committed, so development needs no build step; CI checks it is current. The
test suite honours `$NAV_SERVER_BIN`, so the same tests run against the
sources and against `dist/`.
