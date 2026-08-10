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
├── issues/
│   ├── open/
│   │   └── bqlybac0-login-timeout/
│   │       ├── issue.md
│   │       └── comments/
│   │           └── 2026-08-03T141207Z-t5kr1gq6.md
│   └── closed/
└── prs/
    ├── open/
    ├── merged/
    └── closed/
```

An issue is a Markdown file with YAML frontmatter. Its status is which directory
it sits in. A comment is one file, which is why two people commenting at once
can never conflict. Every forge file browser, every editor, `ls` and `cat` are
complete Navbook clients for reading.

**The files are the product.** The `nav` CLI mints IDs, renders listings and
validates the tree, but nothing requires it: creating, commenting on, closing
and reviewing with a text editor and `git` is a first-class, supported workflow.
No operation exists that only the tool can perform correctly.

## Commands

Everything is noun-verb, with one verb vocabulary shared by both entity kinds.

```
nav {issue|pr} {open|list|show|edit|comment|close|reopen|delete}
nav pr {update|review|merge}
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
| `nav pr review <id> --approve` | Record a verdict bound to a specific revision. |
| `nav pr list --all-refs` | Find PRs on branches you have fetched but not checked out. |
| `nav pr merge <id>` | Merge into the checked-out target, archiving the discussion into its history. |
| `nav doctor [--fix]` | Check the tree against the specification. |

`--commit` on any mutating command wraps the change in a well-formed
Conventional Commits `docs` commit (`docs(issue): close #bqlybac0`,
`docs(pr): merge #dk3mp2x9`). Without it, changes are left staged for your own
commit.

### Query syntax

```sh
nav issue list status:closed label:bug assignee:example.com "timeout"
```

`status:`, `label:`, `assignee:`, `author:`, `milestone:`, and bare words that
match the title, description or any comment body. Terms AND together; the
default query is `status:open`.

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

The repository is a pnpm workspace of two packages. `packages/core`
(`@navbook/core`) is the whole implementation — format logic, git plumbing,
workspace I/O, and the operations behind each verb — and knows nothing about
terminals. `packages/cli` (`@navbook/cli`) adds argument parsing, `$EDITOR`,
prompts and rendering, and installs the `nav` binary. The API server behind
the planned web client will be a third consumer of the same library
([spec 05 §5.2](doc/spec/05-implementation.md)). Development needs no build
step: the library's entry point is its TypeScript source, and Node runs it
directly.

The [conformance fixtures](doc/spec/fixtures/README.md) are golden repositories
that any implementation must pass; they run against `$NAV_BIN`, so the same
suite validates the planned Rust rewrite.

## License

MIT.
