# 3. Branch semantics and merging (normative)

Storing tracker state on code branches means tracker state *forks and merges
with the code*. This is Navbook's superpower (a fix and its issue-close travel
together) and its hardest problem (state can differ between branches). This
document defines what state on a branch means, and how every concurrent-edit
scenario resolves.

## 3.1 The branch of record

- The repository's **default branch** (what `origin/HEAD` designates —
  typically `main`) is the tracker of record. When someone asks "is this issue
  open?", the default branch answers.
- Any other branch shows a **proposed or in-flight state**: a snapshot of the
  record as of its merge-base, plus that branch's staged tracker changes.
  An issue closed on a feature branch is *not closed* until that branch merges
  into the default branch — exactly as a bug fixed on a feature branch is not
  fixed on `main` until merged.
- Tools MUST NOT aggregate tracker state across branches; they report the state
  of the checked-out tree (and MAY additionally label it with the branch name).

**Hygiene (SHOULD):** long-lived branches regularly merge or rebase onto the
default branch, so their tracker snapshot stays fresh; tracker-only changes
(triage, comments on unrelated issues) are committed on the default branch or
short-lived branches, not parked inside long-lived feature branches.

## 3.2 Commit conventions

- Commits that only touch `.navbook/` SHOULD use a [Conventional
  Commits](https://www.conventionalcommits.org/) subject of type `docs`, scoped
  by entity kind: `docs(issue): <action> #<id>` or `docs(pr): <action> #<id>`
  (e.g. `docs(issue): close #bqlybac0`, `docs(pr): comment on #dk3mp2x9`), so
  history readers can filter them at a glance. A tracker-wide change that names
  no entity uses the unscoped `docs:` (e.g. `docs: initialize navbook`).
- To view code history without tracker noise:
  `git log -- ':!.navbook'`. CI pipelines that should not run for tracker-only
  commits SHOULD use an equivalent path filter on `.navbook/`.
- Mixing a code change and its related issue change in one commit is
  legitimate and encouraged where they belong together
  (`fix: raise LB idle timeout` + the issue move + `Closes: bqlybac0`
  trailer).

## 3.3 Concurrency model

The format is designed so that the *frequency* of conflicts tracks the
*genuine contradiction* of the underlying actions:

| Concurrent actions (two branches) | Git outcome | Resolution |
|---|---|---|
| Two new issues/PRs | Distinct directories | Merges clean, always (random IDs) |
| Two comments, same entity | Distinct files | Merges clean, always |
| Comment + metadata edit, same issue | Distinct files (`comments/*` vs `issue.md`) | Merges clean |
| Two edits of the same `issue.md`/`pr.md` | Textual conflict in a small YAML+Markdown file | Resolve by hand; both intents usually compose (e.g. keep both labels) |
| Comment added + issue closed (dir moved), entity already had comments | Directory rename on one side, file addition on the other | Git ≥ 2.18 relocates the comment into the moved directory. Clean with `merge.directoryRenames=true`; with git's default that same relocation is reported as a "file location" conflict to confirm. See 3.3.1 |
| Comment added + issue closed (dir moved), entity had **no** comments yet | Same, but `comments/` is new on one side and renamed on neither | Git cannot infer the move and leaves the comment at the old path. `doctor` reports the orphan; `--fix` moves it. See 3.3.1 |
| Both sides close the same issue | Identical rename | Merges clean if `issue.md` edits are identical; else a small content conflict (e.g. two different `resolution:` values — pick one) |
| Close on one side, edit in place on the other | Rename on one side, edit on the other | Git follows the rename and applies the edit at the new path: the entity ends up closed, carrying both intents. See 3.3.2 |
| Close on one side, slug rename on the other | Rename/rename to two different destinations | **Genuine contradiction**; git cannot choose. See 3.4 |
| Both sides close with different `resolution:` values | Identical rename, contradictory content | Small content conflict in one short file — exactly where a human decision belongs. See 3.4 |
| Delete on one side, edit of the same `issue.md`/`pr.md` on the other | Modify/delete conflict; git leaves the edited file in the tree | **Genuine contradiction**: one side says the entity should not exist, the other is still working on it. Decide, then either finish the deletion or keep the file. See 3.3.3 |
| Delete on one side, new comment on the other | No conflict: git removes the files it knows about and keeps the added one | Merges clean but leaves a directory holding a comment and no entity file, which `doctor` reports as D1. `--fix` cannot reunite it with anything — the entity is gone — so remove the leftover directory by hand. See 3.3.3 |
| Two PRs merged that both moved their own PR dir | Distinct directories | Merges clean |

### 3.3.1 Comments racing a status change

Git infers a *directory* rename from the renames of the files inside it, then
looks up the added file's immediate parent directory. Two consequences follow,
both verified against git 2.43:

**Configure `merge.directoryRenames`.** When the entity already has a
`comments/` directory, the close renames it and git does place the new comment
at the new path — but under git's default (`conflict`) it also marks that path
unmerged, so the merge stops and asks the author to confirm the placement. The
content is already correct; `git add` on the path and a commit finish it. With
`merge.directoryRenames=true` the same merge completes with no conflict at all.
Repositories using Navbook SHOULD therefore set:

```
git config merge.directoryRenames true
```

`nav install` offers exactly this, and it is the difference between "merges
clean" and "merges correctly but stops to ask" for the single most common
concurrent pair in the whole system.

**The first-comment race is not repairable by git.** When the racing comment is
the entity's *first*, `comments/` exists only on the commenting side, so no
rename exists to follow and no setting helps: the comment lands under the old
status directory. This is visible rather than silent — the old path is left
holding a `comments/` directory with no `issue.md`, which violates 2.1 and is a
`doctor` error whose `--fix` is a single move.

Implementations MUST NOT work around this by writing placeholder files into
`comments/`. An empty directory that exists only to shape a future merge is
hidden state, and git does not track empty directories in any case.

### 3.3.2 Status changes usually compose

Verified against git 2.43: a status change is a directory rename, and git's
rename detection carries the *other* side's edits and additions across it. A
close racing an in-place edit therefore merges clean, with the entity closed
and the edit applied — as does a reopen racing an edit, with the reopen
winning.

This is stronger than it first appears. The contradiction that needs a human is
not "one side changed status", which git resolves sensibly, but one of:

- **two different destinations** for the same directory (a close racing a slug
  rename), which is a rename/rename conflict; or
- **contradictory content** at the same destination (two closes recording
  different resolutions), which is a content conflict in a short file.

Both surface loudly, and neither can lose data: the losing side's content is
still in the conflict markers and in history.

### 3.3.3 Deletion racing anything else

Deletion is the one operation that does not compose, because it is the one that
says the entity should not exist. Verified against git 2.43:

- Racing an **edit** of the entity file, git reports a modify/delete conflict
  and leaves the edited file in the tree. This is the right outcome: the two
  sides genuinely disagree about whether the entity exists, and a human picks.
  Finish the deletion (remove the directory) or keep the file.
- Racing a **new comment**, git merges clean — it removes the files the delete
  removed and keeps the file the other side added. What survives is a directory
  holding a comment and no `issue.md`/`pr.md`, which `doctor` reports under D1.
  Unlike the orphan of 3.3.1 there is nothing to reunite it with, so `--fix`
  cannot repair it and `nav delete` cannot target it (it no longer parses as an
  entity); remove the directory by hand.

Neither case can lose committed data: the deleted content remains in history,
recoverable with `git checkout <commit>^ -- <path>`.

## 3.4 Contradictory status changes

When git surfaces one of the conflicts of 3.3.2 (or, worse, auto-resolves a
rename badly), the invariant to restore is:

> **An entity ID MUST exist in exactly one status directory.**

`nav doctor` treats a duplicated ID (e.g. the same issue present under
both `issues/open/` and `issues/closed/` after a bad merge resolution) as an
error.

Resolution guidance (SHOULD):

1. Reconstruct intent from git history (`git log --follow` on both paths):
   the *later deliberate action* wins — a reopen performed after news of the
   close is a real reopen; a close racing a stale copy is just a close.
2. When intent is genuinely simultaneous and contradictory, prefer **closed**
   for issues (the close was made with knowledge of a fix; reopening is cheap
   and explicit) and **open** for PRs (a PR wrongly marked merged is worse than
   one wrongly left open).
3. Never resolve by deleting content: comments and revisions from both sides
   are kept regardless of which status wins (they live in distinct files, so
   this is automatic).

## 3.5 The PR self-reference

A PR's files live on the branch it proposes to merge — three consequences are
spec-level facts, not bugs:

1. **The reviewed SHA can never contain its own review.** Approvals are commits
   *after* the `revision.head` they approve. Verifiers MUST check that a
   verdict's `revision` matches a recorded revision entry, not the commit
   containing the verdict.
2. **The target branch does not show open PRs.** Open PRs are discovered by
   enumerating branches (`nav pr list` scans
   `.navbook/prs/open/` across local and fetched remote branches). This is
   inherent to decentralized operation: you see the PRs of the branches you
   have fetched, exactly as you see their code.
3. **Merging is the state change.** The merge that lands the source branch
   carries the PR directory (moved to `prs/merged/`) into the target's
   history. If the mover forgets, the PR arrives in `prs/open/` on the target
   branch; `doctor` flags a `prs/open/` entry as "merged but not
   archived" when the checked-out branch is the PR's own `target` *and* the
   entry's latest `revision.head` is an ancestor of that branch's head, with the
   move as the suggested fix. Both conditions are required: on the PR's source
   branch its head is trivially an ancestor of `HEAD`, so testing ancestry alone
   would report every open pull request as merged.

## 3.6 Scale and housekeeping

Directory-per-entity keeps reads cheap, but unbounded growth of `closed/`
eventually clutters browsing and slows `git status` on very large trackers
(thousands of entries). Housekeeping is deliberate, never automatic:

- An explicit **archive** operation MAY move old closed entities to
  `.navbook/archive/<year>/issues/...` (structure mirroring 2.1). Archived
  entities keep their IDs; references still resolve. This is a reserved
  convention: v1 tools MUST tolerate the `archive/` subtree (treat as closed)
  but need not provide the operation.
- History is never rewritten for housekeeping; `git log --follow` remains the
  audit trail across moves.

## 3.7 Answering Fossil's objections

Fossil's documentation gives the canonical arguments against in-tree issues;
Navbook's answers, for the record:

1. *"Check-ins are immutable, so issues can't be filed against released
   versions."* — Navbook issues live at branch heads and evolve; a release is
   simply a commit whose tree snapshots the tracker as it stood, which is a
   feature (auditable state at every tag), not a constraint on filing.
2. *"Thousands of issue files clutter the tree."* — One dotted root directory;
   path-filtered logs; explicit archiving (3.6).
3. *"Non-committers must be able to file issues."* — True, and out of scope
   for v1; the gateway design reserved in [06-future.md](06-future.md) commits
   on a reporter's behalf without granting them push access.
