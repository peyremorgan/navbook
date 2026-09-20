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
  error listing the candidates. They also accept what the tools print for an
  entity: `#<id>` as a listing shows it, an `<id>-<slug>` directory name, and
  the `path` that `--json` reports.
- `--commit` on any mutating command wraps the change in a well-formed commit
  (`docs(issue): <action> #<id>` or `docs(pr): <action> #<id>` message per
  §3.2, `Refs:`/`Closes:` trailer as appropriate).
  Without it, changes are left staged in the working tree for the user's own
  commit. `--commit` MUST refuse to run with unrelated changes already staged,
  and on a detached HEAD, where the commit would be reachable from no branch;
  when a branch points at HEAD the refusal names it, and the worktree that has
  it checked out if there is one. Both refusals come before any file is written.
- Author identity is taken from `git config user.name` / `user.email`.
- Machine output: every listing command accepts `--json` (one JSON object per
  entity, schema mirroring the frontmatter plus `id`, `slug`, `status`,
  `path`). `nav pr show --json` additionally carries `review`, the derived
  state of [02 §2.7](02-data-model.md) including the `approvals` it counted,
  and `reviewPolicy`, the policy it counted them against ([02
  §2.10](02-data-model.md)), so a script need not re-derive either. They are on
  `show` and not on `list` because `show` has already read every comment they
  are computed from, and a listing that read them all to fill in one column
  would pay for it on every entity in the tree.
- Exit codes: `0` success; `1` operational error (not found, ambiguous,
  malformed input); `2` format violation detected (doctor errors).

## 4.3 Commands

Entity commands follow a noun-verb shape with one verb vocabulary shared by
both entity kinds:

```
nav {issue | pr} {open | list | show | edit | comment | close | reopen | delete}
```

plus four PR-only verbs (`update`, `request`, `review`, `merge`), the `nav feature`
family below, and repository-level utilities at the root of the command tree
(`nav id`, `nav doctor`, and the setup commands). A verb given an ID of the
other kind MUST fail with a pointer to the right noun (e.g.
`#dk3mp2x9 is a pull request — use 'nav pr show'`).

A tool MAY let an extension ([02 §2.12](02-data-model.md)) add to this command
tree. Where it does, the added nouns sit at the root beside `issue` and `pr`,
because a noun buried under the extension's own name would read as the
extension's business rather than the repository's — `nav feature show auth`,
not `nav kb feature show auth`. A name that collides with a built-in noun, or
with one an extension loaded earlier has taken, MUST be refused rather than
resolved by precedence, and the refusal MUST name the extension that was
skipped: a tree where the same word means two things depending on load order
is worse than one where it means nothing.

Extensions are the subject of the next section.

### Setup

- `nav init` — create the Navbook skeleton (`issues/{open,closed}`,
  `prs/{open,merged,closed}`, with `.gitkeep` files so the empty tree commits),
  and the `navbook.json` marker that identifies the directory (02 §2.10).
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

### Plugins — `nav plugin <verb>`

A **plugin** is how an extension ([02 §2.12](02-data-model.md)) reaches this
CLI. The format names extensions and says where their data may live; this
section says how a machine comes to have one, and the division is deliberate:
a second implementation may load code in an entirely different way and still
read the same trees.

- `nav plugin install [<name>...] [-y]` — install plugins into the store
  below. With no argument it reads the repository's declaration
  ([02 §2.12](02-data-model.md)) and installs what is declared but missing,
  which is the common case after a clone. Like `nav install`, it prints the
  exact actions it is about to take and asks; `-y` skips the question.
- `nav plugin remove <name>` — take one out of the store. The declaration is
  not touched: what a repository says its tree contains is a property of the
  tree, and one machine's uninstall does not change it.
- `nav plugin update [<name>]` — update one, or all of them.
- `nav plugin list [--json]` — what is installed, at which version, and
  whether the repository in hand declares it.

**Names.** A plugin is named by its npm package: `@navbook/plugin-<name>`,
`navbook-plugin-<name>`, or `@scope/navbook-plugin-<name>`, and the package
MUST carry `navbook-plugin` among its `keywords`. The prefix and the keyword
are checked at install, and a package satisfying neither MUST be refused —
which is what keeps `nav plugin install lodash` from being a thing that
happens. `install` MAY accept a short name and expand it (`kb` →
`@navbook/plugin-kb`, then `navbook-plugin-kb`); what it records and what
`list` prints is always the full name.

**The store is per-user, and installing is explicit.** Plugins live in a
directory the tool owns, outside any repository — the reference implementation
uses `$XDG_DATA_HOME/navbook/plugins`. A tool MUST NOT fetch or execute code
because a repository's marker names it: the declaration is read to *report*
what is missing, never to go and get it. This is the one security property of
the whole arrangement, and it is why the declaration and the installation are
two different acts by two different parties.

**What a plugin adds, it declares.** A tool MUST be able to build its command
tree, its help and its completions from a plugin's declaration alone, without
executing the plugin, and MUST NOT load a plugin's code for a command whose
declaration does not name it. This is a performance requirement (§4.2's budget
is measured on a repository with plugins installed) and a predictability one:
`nav --help` and `nav issue list` cost the same whether five plugins are
installed or none.

**Reserved: `nav-<name>` executables on PATH.** The git and cargo convention —
an unrecognized first word sending the tool to look for `nav-<word>` on `PATH`
— is reserved here and deliberately not implemented. It is the obvious way to
write a plugin in another language, and a future revision may take it; what it
cannot do is participate in any of the above. Such a program is not declared by
the repository, cannot add an option to an existing verb, a column to a
listing, a check to `doctor` or a completion, and has no way to be discovered.
Implementations MUST NOT use the `nav-` prefix for anything else.

### Issues — `nav issue <verb>`

- `nav issue open <title> [--label L]... [--assignee EMAIL] [--milestone M] [--feature SLUG]... [--rank N] [--deadline YYYY-MM-DD] [--parent <id>] [-m DESC | --edit]`
  — mint an ID, create `issues/open/<id>-<slug>/issue.md`. Prints path and
  `#id`. `--edit` (default when no `-m`) opens `$EDITOR` on the new file.
  `--parent` files it as a subtask, writing both sides of the link ([2.5](02-data-model.md))
  in the same commit; the parent MUST be resolved before the description is
  composed, so an unknown one is reported before an editor is opened. As with
  the title, what the composed file says is what counts: `--parent` seeds the
  buffer, and an author who edits or removes the `parent:` key in `$EDITOR`
  MUST get the link that file describes, not the one the flag asked for.
- `nav issue list [query]... [--sort priority|deadline|newest]` — issues
  matching all query terms (AND), as a table (`--json` for machines). Default
  query: `status:open`. Grammar below. `--sort` names one of the orders of
  [02 §2.5](02-data-model.md) and defaults to `newest`, which is §4.2's order;
  it orders `--json` as it orders the table, since a caller that pipes a
  listing wants the order it asked for. A `rank` column and a `deadline` column
  appear when any issue listed carries one, as the `labels` column does.
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

The eight shared verbs, plus `update`, `request`, `review`, and `merge`:

- `nav pr open [--target BRANCH] [--title T] [--draft] [--reviewer EMAIL]... [--feature SLUG]...` — on the current
  branch: mint an ID, create `prs/open/<id>-<slug>/pr.md` with `source` = the
  current branch, `target` (default: the default branch), and one revision
  entry pinning `head` = current `HEAD` SHA and `base` = `git merge-base HEAD
  <target>`.
- `nav pr list [query]... [--all-refs]` — open PRs found on the current
  branch; `--all-refs` scans all local and fetched remote branches, skipping
  any PR that the branch answering for it — its `target`, or the default
  branch ([03 §3.1](03-merge-and-branches.md)) — already files under
  `prs/merged/` or `prs/closed/`, because a source branch left behind after
  its merge still carries the `prs/open/` copy that was current before it.
  Same query grammar. When the checked-out tree matches none and other branches
  carry open PRs that `--all-refs` would list — so neither one the tree already
  holds nor one settled as above — their count is written to stderr with a
  pointer to `--all-refs`: a signpost, not a listing, because a checkout of the target
  branch legitimately has nothing to show ([03 §3.5](03-merge-and-branches.md))
  and silence there reads as "there are none".
- `nav pr show <id>`, `nav pr edit <id>`, `nav pr comment <id> ...` — as the
  corresponding `issue` verbs, operating on `pr.md`. `show` reports the review
  decision, how many approvals stand against the number required when that is
  more than one, and the declared policy itself ([02 §2.10](02-data-model.md)).

  Every ID `nav pr list --all-refs` prints MUST resolve for these verbs and for
  `update`, `request` and `review`. When the checked-out tree does not hold the
  pull request, `show` reads it from the ref that carries it, as `close` does,
  names that ref on stderr, and adds it as `refs` to `--json`. The verbs that
  write into its directory (`edit`, `comment`, `update`, `request`, `review`)
  MUST instead refuse with exit 1, naming the branch and, when another
  worktree has it checked out, that worktree. Written here, the file would sit
  beside no `pr.md`, the stranded comment of
  [03 §3.3.1](03-merge-and-branches.md), rather than on the branch under review.
  "No pull request matches" is reserved for an ID that no fetched branch
  carries.
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
- `nav pr request <id> <email>... [--remove]` — add the named people to
  `reviewer:` on `pr.md` ([02 §2.7](02-data-model.md)), or take them off with
  `--remove`. Addresses are matched as identities, not as text: a person
  already listed is not listed twice under another spelling of the same
  address, and `--remove` takes off whichever spelling the file carries.

  It MUST refuse to ask somebody who is not a person ([02 §2.4](02-data-model.md)),
  rather than write a file `doctor` would reject; `--remove` accepts any name,
  since taking one off is how a hand-written mistake is undone. It MUST refuse
  to request a review from the pull request's own author. And it MUST exit 1
  when it would change nothing — every name already listed, or none of them
  listed for `--remove` — naming what it found, since a commit saying a file
  already says what it says is noise in a history people read.

  The commit subjects are `docs(pr): request review #<id>` and
  `docs(pr): remove reviewer #<id>`.
- `nav pr review <id> [--approve | --request-changes | --comment] [-m TEXT | --edit] [--file PATH --line N[-M]]`
  — create a review comment bound to the PR's latest revision (`revision:` set
  automatically; `--revision SHA` to bind an older one). With no verdict flag
  the verdict is `comment` ([02 §2.6](02-data-model.md)): this verb files
  reviews, and a review that judges nothing is still a review, recording that
  its author read the revision it names. To say something without reading a
  revision, use `nav pr comment`, which binds to nothing and carries no
  verdict.

  The one exception is `--file` without a verdict flag, which anchors a comment
  to a line without judging anything: an inline note is discussion about a
  place in the diff, and turning every one of them into a review would say its
  author had read the whole revision.

  A verdict on one's own pull request is written like any other, and warns that
  it will not be counted, unless the review policy allows self-review ([02
  §2.10](02-data-model.md)). The file is the record and it is never refused;
  what the warning prevents is somebody approving their own work and believing
  they have moved the decision.
- `nav pr merge <id> [--method METHOD] [-y|--yes] [--no-sync-source]` — from
  the target branch: land the source branch by the merge method the marker
  declares ([02 §2.10](02-data-model.md)), with the PR directory moved to
  `prs/merged/` and the `merged:` block recorded. `--method` chooses another
  method for this merge alone and takes any of the six names §2.10 defines; a
  name it does not define is exit 1 before anything is read or written.

  | Method | What it runs | Where the directory move goes |
  |--------|--------------|-------------------------------|
  | `auto` | a fast-forward where the branches allow one, else a merge commit | inside the merge commit, or the follow-up where it fast-forwarded |
  | `merge` | a merge commit, always | inside the merge commit |
  | `merge-ff` | a fast-forward, only | the follow-up commit |
  | `rebase` | the source replayed onto the target, then a fast-forward | the follow-up commit |
  | `rebase-no-ff` | the same replay, then a merge commit | inside the merge commit |
  | `squash` | the whole of the source's change as one commit | inside the squash commit |

  The `merged:` block is always written in a commit of its own, because the SHA
  of the commit that lands the branch is unknowable inside that commit. Where
  the method lands no commit of its own, that follow-up carries the directory
  move as well — the immediate follow-up [02 §2.8](02-data-model.md) allows —
  and the block has no `commit:` key, because there is no commit to name.

  `merge-ff` MUST exit 1 without writing anything when the branches cannot
  fast-forward, saying what would make one possible. It is the one method that
  refuses to merge, and what it refuses is a shape of history rather than a
  review state, which is why it is not the gate [02 §2.7](02-data-model.md)
  forbids.

  A replay that conflicts stops exactly as a merge that conflicts does, and is
  finished the same way (`--continue`, below). A replay a tool cannot start —
  a source branch whose commits it is unable to rewrite — is reported rather
  than quietly performed as some other method.

  The commit that records `merged:` lands on the target and nowhere else, so a
  source branch that outlives the merge — `dev` into `main` — would be left one
  commit behind it, with the same pull request reading `merged` on one branch
  and `open` on the other, which is exactly what `--all-refs` would then
  report. Once the merge is recorded, `nav pr merge` therefore fast-forwards
  the source branch to the target and prints `Fast-forwarded <source> to
  <target>`. It is only ever a fast-forward of a local branch that nothing is
  standing on: a source that is a remote-tracking ref, or a branch this clone
  does not hold, is not touched and not mentioned; one that has commits the
  target does not, or that another worktree has checked out, is left where it
  is with a warning saying so — never a merge, never a commit, never a
  conflict. `--no-sync-source` moves the target and nothing else. `--continue`
  performs the same step.

  A method that rewrote the source's commits is reported for what it did
  instead. `rebase` and `rebase-no-ff` move the branch onto the commits the
  replay produced and print `Rebased <source> onto <target>`: the one move that
  is not a fast-forward, made only because rewriting that branch is precisely
  what the method asked for, and made under the same limits as the
  fast-forward — never to a remote-tracking ref, never under another worktree.
  `squash` moves nothing and prints that the source's commits are not on the
  target, because the commit that replaced them is not one anything on that
  branch can fast-forward to; deleting the branch, or resetting it by hand, is
  the user's decision and not the tool's.

  When the repository declares a review policy ([02 §2.10](02-data-model.md))
  and the pull request's decision is not `approved`, it MUST print what is
  missing — how many of the required approvals it has, or who requested
  changes — before merging. It then asks `Merge anyway? [y/N]`, which `--yes`
  answers in advance. Where there is no terminal to ask, it warns on stderr and
  merges: a pipeline that stopped to ask a question nobody can answer would be
  a gate by accident, which [02 §2.7](02-data-model.md) forbids. Declining the
  question exits 1 without merging — the operator's own answer, not a refusal
  by the tool. A repository that declares no policy is merged in silence.
- `nav pr merge --continue [<id>]` — finish a merge that stopped for conflict
  resolution. `nav pr merge` never aborts a conflicted merge: the author's
  resolution is worth keeping, and the remaining steps (moving the directory
  and recording `merged:`) are exactly what is easy to forget. `--continue`
  refuses while any path is still unmerged. With no ID it infers the pull
  request, the method and the target branch from state the interrupted merge
  recorded beside the repository — not inside the tracker, which is a merge
  away from being rewritten — and falls back to `MERGE_HEAD` for a merge git is
  holding that Navbook did not start. `MERGE_HEAD` alone would not do: a
  replay and a squash both stop without one. An unmet policy is reported here
  as a warning and never as a question: the merge is already under way, and the
  moment to have asked has passed.

### Features — `nav feature <verb>`

A feature ([02 §2.11](02-data-model.md)) has no lifecycle and no discussion, so
it borrows none of the shared verbs: there is nothing to close, and the
discussion belongs to the issues attached to it.

- `nav feature open <title> [--slug SLUG] [-m TEXT | --edit]` — create
  `specs/<slug>/feature.md`, deriving the slug from the title when `--slug` is
  absent. It MUST refuse a slug that already names a feature. The summary MAY
  be empty, unlike an issue's description.
- `nav feature list [--json]` — every feature, with how many documents it holds
  and how much of the work attached to it is open.
- `nav feature show <slug> [--commits N] [--json]` — the feature, its
  documents, the issues and pull requests that name it, and the commits that
  have touched it (below). `--commits 0` omits the history.
- `nav feature edit <slug>` — open `feature.md` in `$EDITOR`.
- `nav feature spec add <slug> <title> [--file NAME] [-m TEXT | --edit]` — add a
  specification document, naming the file from the title unless `--file` says
  otherwise. It MUST refuse a name outside the grammar of
  [02 §2.11](02-data-model.md), `feature.md` included.
- `nav feature spec edit <slug> <file>` — open a document in `$EDITOR`.
- `nav feature spec list <slug> [--json]` — the documents a feature holds.

**Commits that touched a feature.** `show` reports a commit when it changed
anything under `specs/<slug>/`, when it changed the directory of an issue or
pull request that names the feature, or when its message references one of
those entities by ID — in prose or in a `Refs:`/`Closes:` trailer
([02 §2.9](02-data-model.md)). That last case is how a commit which only
touches code joins the story, through a trailer it already carries. The listing
is derived on demand and never stored.

### Query grammar

Used by `nav issue list` and `nav pr list`; the noun determines the entity
kind. Terms AND together:

| Term | Matches |
|------|---------|
| `status:open\|closed\|merged` | Entity status (path); `merged` applies to PRs only |
| `label:L` | `L` ∈ `labels` |
| `assignee:EMAIL` | Assignee address (case-insensitive; substring after `@` allowed). A named address, `Name <EMAIL>`, matches by `EMAIL` alone |
| `author:EMAIL` | Author address (same matching) |
| `reviewer:EMAIL` | `EMAIL` ∈ the PR's `reviewer` ([02 §2.7](02-data-model.md)); same matching. PRs only |
| `review:pending\|approved\|changes-requested` | The PR's derived decision ([02 §2.7](02-data-model.md)). PRs only |
| `awaiting:EMAIL` | `EMAIL` is asked to review and is `pending` on the latest revision. PRs only |
| `milestone:M` | Exact milestone |
| `feature:SLUG` | `SLUG` ∈ the entity's `feature` ([02 §2.11](02-data-model.md)) |
| `deadline:overdue\|none` | `overdue`: a `deadline` strictly before today; `none`: no `deadline` at all. Issues only |
| bare word / quoted string | Case-insensitive substring of title, description, or any comment body |

A query naming no status matches every status. The `status:open` default above
is one the `list` commands supply for themselves, not a property of the
grammar: other front ends over the same query — the API of
[06 §6.3](06-future.md) among them — list every status until asked to narrow.

`reviewer`, `review` and `awaiting` describe something only a pull request has,
so `nav issue list` MUST reject them the way it rejects `status:merged`, rather
than matching nothing. The last two read the comment files, as a bare-word
search does, since that is where the verdicts they judge live.

`deadline` runs the other way: it describes something only an issue has
([02 §2.5](02-data-model.md)), so `nav pr list` MUST reject it for the same
reason and in the same words. Today is the day the command runs, in UTC, and
the comparison is strict — an issue due today is not yet overdue.

`nav pr list` shows a `reviewer` column when any pull request listed names one,
as it does for `assignee`, and a `review` column carrying the derived decision.
`nav pr show` renders each person's state under the reviewers it lists.

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
| D13 | The layout and schema of `specs/`: a feature directory name that is not a slug, a file directly in `specs/`, a feature directory with no `feature.md`, or a `feature.md` or document missing a required key ([2.11](02-data-model.md)) | E |
| D14 | An entity's `feature` names a slug with no `specs/<slug>/` directory in this tree | W |
| D15 | `navbook.json` is not a JSON object, or its `review`, `merge` or `plugins` declaration is malformed ([2.10](02-data-model.md), [2.12](02-data-model.md)) | E |

An extension ([02 §2.12](02-data-model.md)) MAY add checks over the data it
defines. They are numbered `X-<short>-<n>` — outside the `D` series, which
belongs to this document, so that a reader of a diagnostic can tell at a glance
which specification to consult and a future `D16` can never collide with
something already shipped. An extension chooses its own levels, subject to the
same meanings: an error is data that no tool can read, a warning is data that
may yet be explained by a branch nobody has fetched.

D13 and D14 are the exception, for the reason the names they check are
([02 §2.12](02-data-model.md)): they predate extensions, this document still
defines what they check, and they are what the conformance fixtures assert. An
implementation is free to provide features natively or through an extension,
and either way reports D13 and D14 — which is what lets one fixture suite
validate both.

D8 MUST NOT report a trailer naming an entity that a `docs(<kind>): delete
#<id>` commit later removed, or that such a commit's `Deletes:` trailers name.
The entity is absent on purpose and history cannot be rewritten to agree, so
the warning would name nothing anyone can act on. Prose and frontmatter
references to a deleted entity are still reported: those live in files the user
can edit.

D14 is a warning for D8's reason: the feature may have been created on a branch
nobody has fetched, and an error would make the order in which two branches
land a correctness question. D13 is an error because a directory that violates
the layout can be read by nothing.

D15 reports one diagnostic per fault it finds, so a marker that mistypes two of
its policy keys names both. It is an error because a policy nobody can read is a
policy nobody is following, and the file is small enough that whoever wrote it
can see what is wrong. It never stops a command: every reader falls back to the
defaults of [02 §2.10](02-data-model.md), reports the fault, and carries on.

D11, D12, D13, D14 and D15 are decidable from the tree alone, so unlike D7, D9
and D10 they run under `--staged` and the pre-commit hook blocks a link broken
by hand. A
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
- No plugin code loaded for a command whose declaration does not name it
  (§4.3), and nothing installed on a repository's say-so.

## 4.5 Git hooks

`nav install --hooks` installs a `pre-commit` hook that runs
`nav doctor --staged` and blocks the commit on errors (exit 2) only —
warnings never block. The hook MUST be a thin shell script calling the binary,
so `--no-verify` and hook removal behave as users expect. If a hook already
exists, the installer appends (with a marker) rather than overwrites, and
`nav uninstall --hooks` removes exactly the marked section.
