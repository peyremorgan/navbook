# @navbook/server

A GraphQL API over a Navbook repository — the server the web client sits on
([spec 06 §6.3](../../doc/spec/06-future.md)).

It imports [`@navbook/core`](../core) and runs the same operations `nav` runs.
Nothing about the format is reimplemented here, and nothing about it needs to
ship to a browser: clients send fields, and the server composes the files.

```sh
npx @navbook/server \
  --repo /srv/navbook-clone \
  --oidc-discovery-url https://accounts.example.com/.well-known/openid-configuration \
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
| `--oidc-discovery-url <url>` | `NAV_SERVER_OIDC_DISCOVERY_URL` | **yes**, unless the next two | — |
| `--oidc-issuer <url>` | `NAV_SERVER_OIDC_ISSUER` | with `--oidc-jwks-url` | taken from the discovery document |
| `--oidc-jwks-url <url>` | `NAV_SERVER_OIDC_JWKS_URL` | with `--oidc-issuer` | taken from the discovery document |
| `--oidc-audience <aud>` | `NAV_SERVER_OIDC_AUDIENCE` | **yes** | — |
| `--require-claim <name>=<value>` | `NAV_SERVER_REQUIRE_CLAIMS` | no | none; repeatable, comma-separated in the variable |
| `--allow-email-domain <domain>` | `NAV_SERVER_ALLOW_EMAIL_DOMAINS` | no | none; repeatable, comma-separated in the variable |
| `--require-email-verified` | `NAV_SERVER_REQUIRE_EMAIL_VERIFIED=true` | no | not required |
| `--remote <name>` | `NAV_SERVER_REMOTE` | no | `origin` |
| `--pull-interval-ms <n>` | `NAV_SERVER_PULL_INTERVAL_MS` | no | `10000` |
| `--git-timeout-ms <n>` | `NAV_SERVER_GIT_TIMEOUT_MS` | no | `30000` (`0` waits as long as git does) |
| `--no-graphiql` | `NAV_SERVER_GRAPHIQL=false` | no | the explorer is served |

The provider is named by its discovery document, which declares both the
issuer a token must carry as `iss` and where the keys are published. That is
the one address that works for every provider, including one whose issuer
carries a path its document does not sit under (`https://auth.example/api/auth`
publishing at `https://auth.example/.well-known/openid-configuration`). A
provider the server cannot reach at start is spelled out instead, with
`--oidc-issuer` and `--oidc-jwks-url` together; giving one without the other,
or either alongside the discovery document, is refused rather than guessed at.

`--pull-interval-ms` is how stale a *read* may let its view of the remote
become; a mutation always fetches first. `--git-timeout-ms` is how long any
one fetch or push may take: one that runs longer is stopped and its request
fails with `SYNC_FAILED`, so a remote that has stopped answering costs one
request rather than every request queued behind it. A stopped push leaves its
commit in the clone, and the next push carries it. There is no way to turn
authentication off: every operation, read or write, needs a valid token.

### Who is allowed in

A verified token proves who is asking; it says nothing about whether they
belong on this repository. A provider is often shared — one sign-in for every
project an organisation runs, sometimes with self-registration — and pointed
at one, a server with no policy is open to everybody that provider knows. The
three options above are the policy, applied after the token verifies and
before any operation runs, `viewer` and introspection included. All are
optional, and every one given has to hold:

- `--require-claim roles=d3952bfb::developer` admits a token whose `roles`
  claim carries that value: equal to it when the claim is a string, holding it
  when the claim is an array, or containing it as a word when the claim is a
  space-separated string — the shape `scope` always has and the one Better
  Auth gives `roles`. Repeat the flag to require several claims. In the
  variable, separate them with commas: `NAV_SERVER_REQUIRE_CLAIMS=roles=d3952bfb::developer,scope=navbook`.
- `--allow-email-domain example.com` admits an `email` under that domain and
  refuses every other, subdomains included. Repeat it for several.
- `--require-email-verified` refuses a token whose `email_verified` is not
  `true`. Without it, a provider that lets somebody set an unverified address
  lets them author as that person.

A token that verifies but fails the policy is refused with `FORBIDDEN` and a
403, not `UNAUTHENTICATED`: the person is signed in, and a client that sent
them back to the provider would loop. The refusal tells them their account is
not allowed on this repository and nothing else; which rule refused whom is
written to the server's log. Starting with no policy at all logs one warning
line saying every token the provider signs for the audience may read and
write, so an open deployment is a visible choice rather than an oversight.

The server also honors `NAV_ROOT`, the variable that names the Navbook
directory when a repository does not use `.navbook/` (see the
[main README](../../README.md#naming-the-directory-something-else)). It has no
flag, because it is not a property of the server: it describes the repository,
and the same value applies to `nav` run in the same clone. A clone whose
directory carries a `navbook.json` marker needs nothing set at all.

The GraphiQL explorer is served by default, and its page is static HTML that
anyone who can reach the port can load — a person pastes their own
`Authorization` header into it to run anything. No operation is answered
without a token, introspection included, but `--no-graphiql` turns the page
off if reaching it at all is more than you want to offer.

## Deploying it

- **Give the clone a committer identity.** `git config user.name` and
  `user.email` in the checkout: that is who the commits are *by*, while
  `author:` is who they are *for*.
- **Make pushing non-interactive.** An SSH key or a credential helper. The
  server runs git with prompts disabled, so a missing credential fails the
  request rather than hanging it.
- **One server per clone.** Operations are serialised against the single
  working tree. Requests are not: git is awaited rather than blocked on, so a
  slow push holds up the operations queued behind it and nothing else — a
  health probe, the GraphiQL page or a refused token is answered meanwhile.
  `--git-timeout-ms` bounds how long the queue can be held.
- **Start it clean.** The server refuses to start on a dirty tree, a detached
  HEAD, or a repository with no `.navbook/` — each of those would otherwise
  surface as a puzzling failure on somebody's first mutation.
- **Say who is allowed in.** Without a policy, any token the issuer signs for
  this audience may read and write — everybody a shared provider knows. Give
  the server the claim, domain or verification it should insist on
  ([above](#who-is-allowed-in)).
- **Identity is the `email` claim.** It is what `author:` records, so an issuer
  that lets somebody set an unverified email lets them author as that person;
  `--require-email-verified` is the answer to that. Tokens must carry an
  expiry; ones without are refused.

[`compose.yaml`](../../compose.yaml) arranges all of that in a container: it
makes the clone on the first start, gives it an identity through the
environment rather than the volume, and pushes with a token. The
[root README](../../README.md#deploying) describes it.

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
`PRECONDITION`, …), plus `UNAUTHENTICATED`, `FORBIDDEN`, `SYNC_CONFLICT`,
`SYNC_FAILED`, `SYNC_PUSH_REJECTED`, `REPARENT_REQUIRED`, `STALE_CONTENT`, and
`GIT_ERROR`. A `GIT_ERROR` says only that a git command failed; what git
actually said goes to the server's log, because its stderr can carry the
remote's URL, server-side paths, and hook output.

Three mutations have a shape worth knowing:

- **`linkIssue`** refuses with `REPARENT_REQUIRED` when the issue already has a
  parent, naming the one it has now. Moving a subtask changes a structure
  somebody else may be reading, so it takes an explicit `allowReparent: true`.
- **`updateIssue`** distinguishes an absent field from an explicit `null`: the
  first leaves the key alone, the second clears it. Frontmatter keys the schema
  does not name are always preserved.
- **`updateSpec`** and **`updateFeature`** require the `baseSha` the editor
  started from, and refuse with `STALE_CONTENT` when the file has moved on
  since. A specification document is prose several people work on, and landing
  a save on top of somebody else's paragraph is exactly the conflict this
  server surfaces rather than resolves. Read the file again, apply the change
  to what it says now, and save with the hash it now carries.
- **`updateIssue`** and **`updatePr`** take the same `baseSha` — `Issue.baseSha`
  and `Pr.baseSha` are the hash of `issue.md` or `pr.md` — but optionally, and
  compare per field rather than per file. A patch is refused with
  `STALE_CONTENT` only when a field it names has changed since the version it
  was composed against; a label set on an issue somebody has just retitled is
  not a conflict with anybody, and lands. The refusal lists the fields that
  moved in `extensions.moved`. Without a hash the patch lands on the file as
  it is, which is what a listing that toggles a label or a drag that sets a
  rank wants: neither has read the file, and neither needs to. A hash this
  server cannot resolve — from a clone it has not fetched — is stale by
  definition.

### Features

`Feature` and `Spec` project the `specs/` tree of spec 02 §2.11: an identity
card, the documents beside it, and — derived rather than stored — the issues
and pull requests that name the feature. `Feature.commits` is the one field
that reads history instead of the tree: it reports commits that changed the
feature's documents, changed a member's directory, or named a member in the
message, which is how a commit that only touches code appears at all. It is
bounded by `limit` and read from the served checkout, so it sees what this
clone has fetched and no more.

### What it does not do

Pull request `merge`, `open` and `update`, entity `delete`, `init`,
`doctor --fix`, and renaming or deleting a feature or one of its documents are
not exposed; they are checkout-centric maintainer actions,
and `doctor` is read-only here. A pull request's files live on the branch it
proposes to merge, so `prs(allRefs: true)` can find one this checkout does not
hold, but commenting on it needs a server serving that branch — the refusal
says which one.

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
