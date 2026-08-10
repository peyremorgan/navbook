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
  (`docs(issue): <action> #<id>` or `docs(pr): <action> #<id>` message per
  §3.2, `Refs:`/`Closes:` trailer as appropriate).
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
nav {issue | pr} {open | list | show | edit | comment | close | reopen | delete}
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

- `nav issue open <title> [--label L]... [--assignee EMAIL] [--milestone M] [--parent <id>] [-m DESC | --edit]`
  — mint an ID, create `issues/open/<id>-<slug>/issue.md`. Prints path and
  `#id`. `--edit` (default when no `-m`) opens `$EDITOR` on the new file.
  `--parent` files it as a subtask, writing both sides of the link ([2.5](02-data-model.md))
  in the same commit; the parent MUST be resolved before the description is
  composed, so an unknown one is reported before an editor is opened. As with
  the title, what the composed file says is what counts: `--parent` seeds the
  buffer, and an author who edits or removes the `parent:` key in `$EDITOR`
  MUST get the link that file describes, not the one the flag asked for.
- `nav issue list [query]...` — issues matching all query terms (AND), as a
  table (`--json` for machines). Default query: `status:open`. Grammar below.
- `nav issue show <id> [--depth N]` — render `issue.md` plus its comments
  (sorted by filename, `reply-to` chains indented) to the terminal. The parent
  and the subtasks are shown with their titles and statuses; `--depth`
  (default 1) says how many levels of subtasks to render. `--json` reports the
  IDs as the file records them and ignores `--depth`.
- `nav issue edit <id>` — open `issue.md` in `$EDITOR` (pure convenience).
- `nav issue comment <id> [-m TEXT | --edit] [--reply-to <comment-id>]` —
  create a comment file with a fresh comment ID and the current UTC time.
- `nav issue close <id> [--resolution R] [--duplicate-of <id>]` — move the
  directory to `closed/`, optionally set `resolution:`.
- `nav issue reopen <id>` — move back to `open/`; remove `resolution:`.
- `nav issue link <id> --parent <id> [-f|--force]` — file one issue under
  another, writing both sides of the link in one commit and taking the subtask
  off any other list that still claims it. The postcondition is exact:
  afterwards the issue names one parent and that parent is the only issue
  listing it, which is what makes this verb the way to mend a link edited by
  hand. It MUST refuse a link an issue's own file already records on both
  sides, one that would make an issue its own parent, and one that would put an
  issue below itself; the loop refusal SHOULD name the chain. Moving a subtask
  that already has a parent changes a structure other people read, so it MUST
  be confirmed first; `--force` skips the question, and an unanswerable one
  (stdin is not a terminal) counts as "no", leaves the tree untouched, and
  exits 1.
- `nav issue unlink <id>` — detach the issue from its parent, clearing the
  `parent` key and every `subtasks` entry naming it. It exits 1 when nothing
  claims the issue.
- `nav issue delete <id> [-f|--force] [-r|--recursive]` — remove the entity's directory and
  everything in it. Closing records how work ended; deleting says it should
  never have been filed — a duplicate opened twice, an issue meant for another
  repository — so it removes rather than moves, and it accepts an entity in any
  status, `archive/` included. What git already holds is recoverable from
  history, so the command MUST delete without asking when the directory is
  clean, and MUST print what would be lost and ask for confirmation when it
  holds uncommitted changes; `--force` skips the question. A refusal (including
  a declined prompt, and an unanswerable one where stdin is not a terminal) MUST
  leave the tree untouched and exit 1.

  Deleting an issue severs the links to it in the same commit, so the tree is
  never left holding one. Its subtasks survive as top-level issues and MUST be
  named in the output, since that is easy to miss and tedious to undo from
  memory. `--recursive` instead removes the whole subtree — every issue whose
  `parent` chain reaches the named one, to any depth — in a single commit; an
  issue that a `subtasks` list names but that does not name it back is not a
  subtask, so it is unlisted rather than removed.

  With `--commit`, the subject is `docs(<kind>): delete #<id>` and the commit
  MUST carry no `Refs:`/`Closes:` trailer: it would name the entity the commit
  removes and so dangle by construction. Doctor reads that subject back — see
  D8 below. A recursive delete removes entities the subject does not name, so
  it records each of them as a `Deletes: <id>` trailer. `Deletes:` is not a
  reference — it names what the commit took away — and D8 reads it back for the
  same reason it reads the subject, though only from a commit whose subject
  already says it deleted something: silencing a warning is not a power any
  commit may claim by writing one line.

### Pull requests — `nav pr <verb>`

The eight shared verbs, plus `update`, `review`, and `merge`:

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
  `prs/closed/` on the current branch. A PR's files normally live on its source
  branch, so when the ID is not present in the checked-out tree the directory is
  first checked out from the ref that carries it — the manual recipe of
  [02 §2.8](02-data-model.md), performed for the user.
- `nav pr reopen <id>` — move a `prs/closed/` entry back to `prs/open/`;
  remove `resolution:`. A merged PR cannot be reopened.
- `nav pr delete <id> [-f|--force]` — as `nav issue delete`, with one
  difference: it MUST act on the checked-out tree alone. Unlike `close`, it
  does not fetch the directory from the ref that carries it — a copy brought
  onto this branch only to be removed again would leave the original in place
  on its source branch, which is not what the user asked for. Delete a pull
  request on the branch that holds it.
- `nav pr update <id>` — append a revision entry for the current `HEAD`
  (refuses if `HEAD` equals the last recorded head).
- `nav pr review <id> [--approve | --request-changes] [-m TEXT | --edit] [--file PATH --line N[-M]]`
  — create a review comment bound to the PR's latest revision (`revision:` set
  automatically; `--revision SHA` to bind an older one).
- `nav pr merge <id> [--no-ff]` — from the target branch: `git merge` the
  source branch with the PR directory moved to `prs/merged/` inside the merge
  commit, then record the `merged:` block in a follow-up commit
  (the merge SHA is unknowable inside the merge itself). When the merge can
  fast-forward and `--no-ff` was not given, there is no merge commit to carry
  the move, so the archive and the `merged:` block are written together in the
  immediate follow-up commit that [02 §2.8](02-data-model.md) allows; the block
  then has no `commit:` key, because no merge commit exists to name.
- `nav pr merge --continue [<id>]` — finish a merge that stopped for conflict
  resolution. `nav pr merge` never aborts a conflicted merge: the author's
  resolution is worth keeping, and the remaining steps (moving the directory
  and recording `merged:`) are exactly what is easy to forget. `--continue`
  refuses while any path is still unmerged, and infers the pull request from
  `MERGE_HEAD` when no ID is given.

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
| D9 | `prs/open/` entry whose head is an ancestor of the current branch, when that branch is the PR's own `target` ("merged but not archived", [03 §3.5](03-merge-and-branches.md)) | W |
| D10 | Frontmatter timestamps wildly inconsistent with git history | W |
| D11 | `parent` and `subtasks` disagree, or a link names a pull request ([2.5](02-data-model.md)) | E |
| D12 | The `parent` chain loops, an issue naming itself included | E |

D8 MUST NOT report a trailer naming an entity that a `docs(<kind>): delete
#<id>` commit later removed, or that such a commit's `Deletes:` trailers name.
The entity is absent on purpose and history cannot be rewritten to agree, so
the warning would name nothing anyone can act on. Prose and frontmatter
references to a deleted entity are still reported: those live in files the user
can edit.

D11 and D12 are decidable from the tree alone, so unlike D7, D9 and D10 they
run under `--staged` and the pre-commit hook blocks a link broken by hand. A
D11 repair is not offered there, though: it rewrites a whole file, and under
`--staged` that file's content came from the index, so writing it back into the
working tree would discard whatever was not staged.

`--fix` repairs a D11 that the tree can settle without discarding anything
anyone asserted: adding the missing reciprocal entry, and dropping a repeated
one. Two issues claiming the same subtask is not such a case — both files are
well-formed and both assertions were made on purpose — so it is settled from
git history instead, by letting the claim made last stand and removing the
others. Where history cannot say, because a claim is uncommitted or because two
were made in the same commit, the fault MUST be reported rather than guessed
at. So MUST a dispute in which any claim names an issue this tree does not
hold: that issue may be the right parent, on a branch nobody has fetched, and
the repair would delete the only record here that it exists. D12 is never
repaired: every link on a loop is equally suspect, and only its author knows
which was the mistake — and since `--fix` applies its repairs together, it MUST
judge them together too, withdrawing any that would only close a loop between
them.

D7, D9 and D10 read git history and are therefore skipped by `--staged` (the
commit being validated does not exist yet) and wherever the history is
unavailable — a shallow clone, or a `revision.head` on a branch nobody has
fetched. An absent object is not evidence of a fault.

"Wildly inconsistent" in D10 is deliberately not a fixed number in this
specification. Implementations MUST document the threshold they use; the
reference implementation warns beyond **48 hours**, which absorbs offline work,
a delayed push and timezone confusion while still catching a timestamp typed
with the wrong year.

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
