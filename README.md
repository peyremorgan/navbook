# Navbook

_A lightweight software project manager that lives inside your git repo._

Navbook stores every issue and pull request as plaintext files inside the
repository, on the same branch and history as the code they describe. There is
no server, no database, and no hidden ref namespace. If you can clone the
repository, you have the whole tracker.

This is meant to replace your code forge's issues with a portable,
decentralised, offline-first solution. Is GitHub down? No big deal — you'll push
your comment to `origin` whenever it's available again.

```console
$ nav issue open "Login times out on slow connections" --label bug -m "Aborts after 5 s on 3G."
Created .navbook/issues/open/bqlybac0-login-timeout/  (#bqlybac0)

$ nav issue list
ID         STATUS  TITLE                                LABELS
#bqlybac0  open    Login times out on slow connections  bug

$ nav issue close bqly --resolution fixed --commit
Closed #bqlybac0  .navbook/issues/closed/bqlybac0-login-timeout/
Committed docs(issue): close #bqlybac0
```

That last command moved a directory and made a commit. On the branch that fixes
the bug, the fix and the close travel together — merging the branch merges both.

## Install

Requires Node 24 or newer and a working `git`.

```sh
npm install -g @navbook/cli     # or: npx @navbook/cli <command>
cd your-repo
nav init
nav install                # git alias, merge config, pre-commit hook, completions
```

`nav install` prints every change it is about to make and asks before making
it, `apt`-style. `-y` skips the question; `nav uninstall` removes exactly what
it added.

The one setting worth knowing about is `merge.directoryRenames=true`, which
`nav install` offers. Without it, the most common concurrent pair in Navbook — a
comment racing a close — is placed correctly by git but still reported as a
conflict to confirm. With it, that merge is clean.

## What it looks like on disk

```
.navbook/
├── navbook.json
├── issues/
│   ├── open/
│   │   └── bqlybac0-login-timeout/
│   │       ├── issue.md
│   │       └── comments/
│   │           └── 2026-08-03T141207Z-t5kr1gq6.md
│   └── closed/
├── prs/
│   ├── open/
│   ├── merged/
│   └── closed/
└── specs/
    └── auth/
        ├── feature.md
        └── login-flow.md
```

An issue is a Markdown file with YAML frontmatter. Its status is which directory
it sits in. A comment is one file, which is why two people commenting at once
can never conflict. Every forge file browser, every editor, `ls` and `cat` are
complete Navbook clients for reading.

`specs/` holds **features** — the standing concepts work attaches to. A feature
is a directory named after itself, holding a `feature.md` and however many
specification documents describe it. An issue joins one by naming it:

```console
$ nav feature open "Authentication" --slug auth -m "Signing in, sessions, tokens."
Created .navbook/specs/auth/  (auth)

$ nav issue open "Login times out" --feature auth -m "Aborts after 5 s on 3G."
$ nav feature show auth
```

Nothing lists the members on the feature's side, so two people attaching two
issues touch two different files. `nav feature show` works the membership out
from the issues, and reads the commits that touched them straight out of git.

**The files are the product.** The `nav` CLI mints IDs, renders listings and
validates the tree, but nothing requires it: creating, commenting on, closing
and reviewing with a text editor and `git` is a first-class, supported workflow.
No operation exists that only the tool can perform correctly.

### Naming the directory something else

`.navbook/` is a default, not a requirement. To use another name, set
`NAV_ROOT` when you create the tree:

```console
$ NAV_ROOT=.issues nav init --commit
Created .issues/
Committed docs: initialize navbook
Next: nav issue open "Something is broken"
```

You only need the variable that once. `nav init` writes a `navbook.json` marker
into the directory it creates, and that marker is how the directory is found
afterwards — so everyone who clones the repository gets a working `nav` with
nothing to configure, which an environment variable alone could never give
them. The name is resolved per command, in this order:

1. `NAV_ROOT`, when it is set to a relative path inside the repository.
2. `.navbook/`, when it exists.
3. The directory carrying `navbook.json` — searched for among the repository
   root's own subdirectories, then among the paths git has staged, which is
   what finds a nested root such as `.github/navbook/`.

If two directories both carry a marker, `nav` says so and stops rather than
picking one; set `NAV_ROOT` to say which you mean. A repository created before
markers existed has none, and keeps working through step 2.

The marker is also where a repository says what a review is supposed to add up
to — how many approvals, and whether an author may review their own work:

```json
{
  "version": 1,
  "review": {
    "selfReview": false,
    "minApprovals": 2
  }
}
```

That is a reading, not a rule. `nav pr show` counts approvals against it,
`nav pr merge` says what is missing and asks before merging short of it, and
neither of them ever refuses: Navbook records reviews and enforces nothing
([spec 01 §1.7](doc/spec/01-functionality.md)). Leave the key out and one
approval is enough, which is what every repository did before it existed.

## Commands

Everything is noun-verb, with one verb vocabulary shared by both entity kinds.

```
nav {issue|pr} {open|list|show|edit|comment|close|reopen|delete}
nav pr {update|request|review|merge}
nav feature {open|list|show|edit}
nav feature spec {add|edit|list}
nav {init|id|doctor|install|uninstall}
```

IDs accept any unambiguous prefix of four characters or more, so `bqly` is
usually enough. A full directory name works too.

| Command | What it does |
|---|---|
| `nav issue open <title>` | File an issue. `-m TEXT`, or `$EDITOR` opens on the new file. |
| `nav issue list [query]` | Filtered table; `--json` for one JSON object per line. |
| `nav issue close <id> [--resolution R]` | Move it to `closed/`. |
| `nav issue open <title> --parent <id>` | File it as a subtask. `nav issue link`/`unlink` do the same for issues that already exist; trees nest as deep as you like. |
| `nav issue show <id> [--depth N]` | Render it, with the title and status of its parent and of the subtasks beneath it. |
| `nav issue delete <id>` | Remove its directory entirely — for the duplicate you filed twice. Its subtasks survive as top-level issues unless you pass `--recursive`. Asks first if it holds uncommitted changes; `--force` skips that. |
| `nav pr open [--target BRANCH]` | Open a PR from the current branch, pinning the exact head and merge base under review. |
| `nav pr request <id> <email>` | Ask someone to review it. Being listed is the request; nothing records it answered, and a new revision asks again. |
| `nav pr review <id> --approve` | Record a verdict bound to a specific revision. Without a flag the verdict is `comment`: a review that judges nothing. |
| `nav pr list awaiting:me@example.com` | Pull requests waiting on one person. `reviewer:` and `review:approved` filter the same listing. |
| `nav pr list --all-refs` | Find PRs on branches you have fetched but not checked out. |
| `nav pr merge <id>` | Merge into the checked-out target, archiving the discussion into its history. Says what a declared review policy is missing, and asks; `--yes` answers in advance. |
| `nav feature open <title>` | Create a feature under `specs/`. `--slug` names its directory; the title otherwise. |
| `nav feature show <slug>` | Its documents, the issues and pull requests that name it, and the commits that touched any of them. |
| `nav feature spec add <slug> <title>` | Add a specification document. `nav feature spec edit` opens one in `$EDITOR`. |
| `nav issue open <title> --feature <slug>` | File it against a feature. Repeatable; `nav issue list feature:auth` finds them again. |
| `nav doctor [--fix]` | Check the tree against the specification. |

`--commit` on any mutating command wraps the change in a well-formed
Conventional Commits `docs` commit (`docs(issue): close #bqlybac0`,
`docs(pr): merge #dk3mp2x9`). Without it, changes are left staged for your own
commit.

### Query syntax

```sh
nav issue list status:closed label:bug assignee:example.com "timeout"
```

`status:`, `label:`, `assignee:`, `author:`, `milestone:`, `feature:`, and bare
words that match the title, description or any comment body. Terms AND
together; the default query is `status:open`.

## Why the design is what it is

Three properties drive everything else:

- **Browsable.** The tracker renders on any forge with no plugin, because it is
  just Markdown in human-named directories.
- **Same history as the code.** `git log`, `git blame` and `git bisect` work on
  tracker state exactly as they do on code. A release tag captures what the
  tracker said at that moment.
- **No coordination.** IDs are 8 random characters, not sequential numbers —
  the single most repeated mistake in this problem space. Two people can file
  issues offline, on different branches, and never collide.

Pull requests live on the branch they propose to merge, so opening one needs no
server and works offline. Merging carries the whole discussion into the target
branch's permanent history. Approvals are bound to the exact revision they
judged, so a force-push can never inherit a stale approval.

## Platforms

Developed and tested on Linux and macOS. Windows is not guaranteed; use
[Git Bash](https://gitforwindows.org/) or WSL, where Navbook works because both
provide the POSIX shell the hooks and completions expect.

## Deploying

The API and the web client ship as two containers, described by
[`compose.yaml`](compose.yaml) and configured by one file:

```sh
cp .env.example .env      # then edit it
docker compose up -d --build
```

[`.env.example`](.env.example) names every key with the value it takes when you
leave it alone, and is the reference for what each one does. Four things have
to exist first:

- **A Traefik** with its Docker provider watching a network the containers can
  join (`docker network create traefik`). Nothing about Traefik itself is
  configured here — the containers carry host rules and it does the rest.
- **Two hostnames**, one for the client and one for the API. They need not
  share a domain: the API answers any origin that brings an `Authorization`
  header.
- **An identity provider**, because authentication has no off switch. What it
  has to mint is in the [web client's README](packages/web/README.md#deploying-it).
- **A repository, and a token that may push to it.** The token is what commits
  reach the remote as; the person a commit is *for* comes from their own token
  and is recorded as `author:`.

The API container makes its own clone on the first start and keeps it in a
volume. That volume is not a database — it can be deleted, and the next start
fetches the repository again. Changing any value in `.env` is an edit and a
restart, because both containers read their configuration when they start:
nothing is baked into an image, including which API the client talks to.

Two things worth knowing when something goes wrong. A push the server cannot
land is reported as `SYNC_CONFLICT` and **left committed in the clone** for a
person to reconcile — `docker compose exec api sh` puts you in it, and the
container will not throw that work away on the next restart. And the server
refuses to start on a clone with a dirty tree or a detached HEAD, which is the
same thing said earlier: it would otherwise surface as a puzzling failure on
somebody's first mutation.

The details of each half — every server option, and what the client reads at
boot — are in [`packages/server`](packages/server/README.md#deploying-it) and
[`packages/web`](packages/web/README.md#deploying-it).

## Documentation

The [specification](doc/spec/README.md) is the normative definition of the file
format and the reference for anyone writing another implementation. Start with
[01-functionality.md](doc/spec/01-functionality.md) for what Navbook does, or
[02-data-model.md](doc/spec/02-data-model.md) for the exact file format.

## Contributing

Navbook tracks its own development in `.navbook/` — run `nav issue list` in a
clone to see what is open.

```sh
pnpm install
pnpm test          # every package's suite, plus conformance
pnpm check         # lint and type-check
pnpm bench         # the performance budget, on its own machine
```

The repository is a pnpm workspace of four packages. `packages/core`
(`@navbook/core`) is the whole implementation — format logic, git plumbing,
workspace I/O, and the operations behind each verb — and knows nothing about
terminals. `packages/cli` (`@navbook/cli`) adds argument parsing, `$EDITOR`,
prompts and rendering, and installs the `nav` binary. `packages/server`
([`@navbook/server`](packages/server/README.md)) is the GraphQL API, and runs
the same operations the CLI runs. `packages/web`
([`@navbook/web`](packages/web/README.md)) is the browser interface on top of
it: a static single-page app that sends fields and lets the server compose the
files, so nothing about the format ships to a browser
([spec 05 §5.2](doc/spec/05-implementation.md), [06 §6.3](doc/spec/06-future.md)).
Development needs no build step outside the web client: a library's entry point
is its TypeScript source, and Node runs it directly.

The [conformance fixtures](doc/spec/fixtures/README.md) are golden repositories
that any implementation must pass; they run against `$NAV_BIN`, so the same
suite validates the planned Rust rewrite.

### Running the web client

The client is a thin UI over an API that needs a token for every operation, so
developing it means three processes. One command starts all of them:

```sh
pnpm --filter @navbook/web dev:stack
```

Then open <http://localhost:3000> and sign in as anybody — the address you type
is what every issue and comment you file will record as its author.

| | |
|---|---|
| <http://localhost:3000> | the client, on Vite, reloading as you edit |
| <http://localhost:4000/graphql> | `nav-server`, with GraphiQL for poking at the API |
| <http://localhost:9000> | a development OIDC provider, with a form that asks who you are |

The repository being served is a throwaway built under the system temporary
directory, seeded with issues and pull requests worth looking at, and kept
between runs so what you filed yesterday is still there. `--fresh` rebuilds it.
It is deliberately **not** the repository you are standing in: every mutation
commits, and a stray click should not file an issue against Navbook itself.

The development provider has no client secret, no consent and no user database,
so anyone may be anyone. It exists because authentication has no off switch —
the API answers nothing without a token — and `nuxi dev` needs something to log
into. Never point anything else at it.

To run the three by hand instead, or to deploy the built bundle, see the
[package README](packages/web/README.md).

### Building and testing it

```sh
pnpm --filter @navbook/web build      # nuxi generate → packages/web/.output/public
pnpm --filter @navbook/web test       # the unit suite; also runs in `pnpm test`
pnpm --filter @navbook/web test:e2e   # Playwright, against a real stack
```

The build emits static files: copy `.output/public` to any host and overwrite
its `config.json` with the addresses that deployment uses. Nothing else is
configured, because one built artefact has to serve every deployment.

The end-to-end suite is kept out of `pnpm test` because it needs two things
that suite has no use for — a browser and a built bundle:

```sh
pnpm --filter @navbook/web exec playwright install chromium
pnpm --filter @navbook/web build
pnpm --filter @navbook/web test:e2e
```

It starts an issuer, a `nav-server` and a fixture repository with an origin to
push to, and serves what `nuxi generate` produced rather than a dev server,
because that is what gets deployed. Nothing in it is mocked: the point is to
prove that a browser, an OIDC flow, a GraphQL API and a git repository work
together.

## License

MIT.
