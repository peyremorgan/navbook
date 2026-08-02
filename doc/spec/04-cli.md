# 4. The `nav` CLI

The CLI is a convenience layer over the format in [02](02-data-model.md). Every
command's effect is expressible as plain file operations plus git; the CLI MUST
NOT create or depend on state outside `.navbook/` (excepting disposable caches
under the user's cache directory, which any command must be able to rebuild,
and the environment integrations that `nav install`/`nav uninstall` manage
with the user's confirmation).

## 4.1 Invocation

- The binary is `nav`.
- A git-subcommand alias is offered via `nav install --alias[=<name>]`, which
  runs `git config --global alias.<name> '!nav'`. The name **defaults to
  `nav`** (so `git nav <cmd>` works out of the box); it is configurable for
  users who prefer another spelling (e.g. `git issue`) or need to avoid a
  collision with some other tool.
- All commands run from anywhere inside a repository (the CLI locates
  `.navbook/` by walking up, like git locates `.git`).

## 4.2 Global behavior

- **ID arguments** accept any unambiguous prefix (≥ 4 chars); ambiguity is an
  error listing the candidates.
- `--commit` on any mutating command wraps the change in a well-formed commit
  (`nb: <action> #<id>` message, `Refs:`/`Closes:` trailer as appropriate).
  Without it, changes are left staged in the working tree for the user's own
  commit. `--commit` MUST refuse to run with unrelated changes already staged.
- Author identity is taken from `git config user.name` / `user.email`.
- Machine output: every listing command accepts `--json` (one JSON object per
  entity, schema mirroring the frontmatter plus `id`, `slug`, `status`,
  `path`).
- Exit codes: `0` success; `1` operational error (not found, ambiguous,
  malformed input); `2` format violation detected (doctor errors).

## 4.3 Commands

Entity commands follow a noun-verb shape with one verb vocabulary shared by
both entity kinds:

```
nav {issue | pr} {open | list | show | edit | comment | close | reopen}
```

plus three PR-only verbs (`update`, `review`, `merge`) and repository-level
utilities at the root of the command tree (`nav id`, `nav doctor`, and the
setup commands). A verb given an ID of the
other kind MUST fail with a pointer to the right noun (e.g.
`#dk3mp2x9 is a pull request — use 'nav pr show'`).

### Setup

- `nav init` — create the `.navbook/` skeleton (`issues/{open,closed}`,
  `prs/{open,merged,closed}`, with `.gitkeep` files so the empty tree commits).
- `nav install [--alias[=NAME]] [--hooks] [--completions[=SHELL]] [-y]` — set
  up environment integrations:
  - `--alias[=NAME]` — run `git config --global alias.<NAME> '!nav'`
    (see 4.1). `NAME` defaults to `nav`.
  - `--hooks` — install the `pre-commit` hook described in 4.5.
  - `--completions[=SHELL]` — completions for `SHELL` (`bash`, `zsh`, or
    `fish`; default: detected from `$SHELL`), including dynamic ID/slug
    completion for commands taking an ID. Given explicitly, the script is
    printed to stdout for users who manage their own shell configuration;
    in install-everything mode it is instead written to the shell's standard
    user completions directory.

  With no flags, `nav install` sets up everything: alias (default name),
  hook, and completions (installed, not printed). Like `apt`, any invocation
  that will change files or configuration first prints the exact actions it
  is about to take (the `git config` command to be run, the hook path, the
  completions file) and asks for confirmation; `-y`/`--yes` skips the
  prompt. Printing completions to stdout changes nothing and therefore never
  prompts.
- `nav uninstall [--alias[=NAME]] [--hooks] [--completions] [-y]` — remove
  what `install` set up (no flags: everything it may have installed), with
  the same confirm-or-`--yes` behavior.

### Issues — `nav issue <verb>`

- `nav issue open <title> [--label L]... [--assignee EMAIL] [--milestone M] [-m DESC | --edit]`
  — mint an ID, create `issues/open/<id>-<slug>/issue.md`. Prints path and
  `#id`. `--edit` (default when no `-m`) opens `$EDITOR` on the new file.
- `nav issue list [query]...` — issues matching all query terms (AND), as a
  table (`--json` for machines). Default query: `status:open`. Grammar below.
- `nav issue show <id>` — render `issue.md` plus its comments (sorted by
  filename, `reply-to` chains indented) to the terminal.
- `nav issue edit <id>` — open `issue.md` in `$EDITOR` (pure convenience).
- `nav issue comment <id> [-m TEXT | --edit] [--reply-to <comment-id>]` —
  create a comment file with a fresh comment ID and the current UTC time.
- `nav issue close <id> [--resolution R] [--duplicate-of <id>]` — move the
  directory to `closed/`, optionally set `resolution:`.
- `nav issue reopen <id>` — move back to `open/`; remove `resolution:`.

### Pull requests — `nav pr <verb>`

The seven shared verbs, plus `update`, `review`, and `merge`:

- `nav pr open [--target BRANCH] [--title T] [--draft]` — on the current
  branch: mint an ID, create `prs/open/<id>-<slug>/pr.md` with `source` = the
  current branch, `target` (default: the default branch), and one revision
  entry pinning `head` = current `HEAD` SHA and `base` = `git merge-base HEAD
  <target>`.
- `nav pr list [query]... [--all-refs]` — open PRs found on the current
  branch; `--all-refs` scans all local and fetched remote branches. Same
  query grammar.
- `nav pr show <id>`, `nav pr edit <id>`, `nav pr comment <id> ...` — as the
  corresponding `issue` verbs, operating on `pr.md`.
- `nav pr close <id> [--resolution declined]` — record the PR under
  `prs/closed/` on the current branch.
- `nav pr reopen <id>` — move a `prs/closed/` entry back to `prs/open/`;
  remove `resolution:`. A merged PR cannot be reopened.
- `nav pr update <id>` — append a revision entry for the current `HEAD`
  (refuses if `HEAD` equals the last recorded head).
- `nav pr review <id> [--approve | --request-changes] [-m TEXT | --edit] [--file PATH --line N[-M]]`
  — create a review comment bound to the PR's latest revision (`revision:` set
  automatically; `--revision SHA` to bind an older one).
- `nav pr merge <id> [--no-ff]` — from the target branch: `git merge` the
  source branch with the PR directory moved to `prs/merged/` inside the merge
  commit, then record the `merged:` block in a follow-up commit
  (the merge SHA is unknowable inside the merge itself).

### Query grammar

Used by `nav issue list` and `nav pr list`; the noun determines the entity
kind. Terms AND together:

| Term | Matches |
|------|---------|
| `status:open\|closed\|merged` | Entity status (path); `merged` applies to PRs only |
| `label:L` | `L` ∈ `labels` |
| `assignee:EMAIL` | Assignee address (case-insensitive; substring after `@` allowed) |
| `author:EMAIL` | Author address (same matching) |
| `milestone:M` | Exact milestone |
| bare word / quoted string | Case-insensitive substring of title, description, or any comment body |

### Root utilities

- `nav id` — mint and print a fresh valid ID (for hand-editors and
  scripts).

### Validation

- `nav doctor [--staged]` — check the tree (or only files staged in the
  index) against [02](02-data-model.md) and [03](03-merge-and-branches.md).
  `--fix` MAY offer mechanical repairs (e.g. archive a merged-but-open PR);
  it MUST print each fix and MUST NOT touch files outside `.navbook/`.

Doctor checks (E = error → exit 2, W = warning → exit 0 with report):

| # | Check | Level |
|---|-------|-------|
| D1 | Directory/file names match the grammars (2.1, 2.3, 2.6) | E |
| D2 | Required frontmatter keys present and well-typed | E |
| D3 | ID uniqueness across the whole tree (incl. archive, comments) | E |
| D4 | Entity present in exactly one status directory | E |
| D5 | `reply-to` targets exist within the same entity | E |
| D6 | Review `revision` matches a recorded revision entry | E |
| D7 | `revisions` list non-empty; entries append-only vs git history | E |
| D8 | Dangling `#id` / trailer references | W |
| D9 | `prs/open/` entry whose head is an ancestor of the current branch ("merged but not archived", 3.5) | W |
| D10 | Frontmatter timestamps wildly inconsistent with git history | W |

Hand-edits that are unusual but valid MUST pass: doctor enforces the spec, not
a house style.

## 4.4 What the CLI does not do

- No daemon, no lock files, no state outside the tree.
- No network operations of any kind in v1.
- No automatic archiving, renumbering, or "cleanup" — every mutation is an
  explicit command.

## 4.5 Git hooks

`nav install --hooks` installs a `pre-commit` hook that runs
`nav doctor --staged` and blocks the commit on errors (exit 2) only —
warnings never block. The hook MUST be a thin shell script calling the binary,
so `--no-verify` and hook removal behave as users expect. If a hook already
exists, the installer appends (with a marker) rather than overwrites, and
`nav uninstall --hooks` removes exactly the marked section.
